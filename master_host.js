#!/usr/bin/env node

var redis = require("redis");
var assert = require('assert');
var program = require('commander');
var restify = require('restify');
var uuid = require('node-uuid'); //need to install
var Gearman = require("node-gearman");
var qs = require('querystring');
var logger = require('tracer').dailyfile({root:'.', format : "{{timestamp}} <{{title}}> {{message}}",
		dateformat : "HH:MM:ss"});

/*----------------------------------------------------
	handle command lines
----------------------------------------------------*/

program	.version('0.0.1')
	.option('-p, --port [port]', 'this port this server listen on, default 8080', '8080')
	.option('-g, --gmhost [ip:port]', 'gearman host(TCP)', '127.0.0.1:4730')
	.parse(process.argv);

function split_host(val, default_port) {
	var ret = val.split(':');
	if (ret.length == 1) {
		ret.push(default_port);
	}
	return ret;
}

var gm_host = split_host(program.gmhost, '4730');

/*----------------------------------------------------
	initial the program
	start the deamon thread
----------------------------------------------------*/
var gm_client = new Gearman(gm_host[0], gm_host[1]);

var max_submited_dirs = 100;
var max_submited_files = 100;

var getdir_jobs = [];
var getdir_jobs_empty = [];
var parsing_jobs = [];

var getdir_queue_counter = 0;
var parse_queue_counter = 0;
var getdir_jobs_queue = [];
var parsing_jobs_queue = [];

var redis_client = redis.createClient();
redis_client.flushdb();

redis_client.on("error", function (err) {
	logger.error("redis " + err);
});

function enqueue_getdir(sender)
{
	getdir_queue_counter++;
	redis_client.lpush('getdir_queue', JSON.stringify(sender));
}

function dequeue_getdir(pop_cb)
{
	redis_client.rpop('getdir_queue', function (err, reply) {
		if (reply) {
			getdir_queue_counter--;
			pop_cb(JSON.parse(reply));
		}
	});
}

function enqueue_parse(sender)
{
	parse_queue_counter++;
	redis_client.lpush('parse_queue', JSON.stringify(sender));
}

function dequeue_parse(pop_cb)
{
	redis_client.rpop('parse_queue', function (err, reply) {
		if (reply) {
			parse_queue_counter--;
			pop_cb(JSON.parse(reply));
		}
	});
}

var client_tick_counter = 0;
var getdir_jobs_counter = 0;
var parsed_jobs_counter = 0;

function getdir_jobs_ok(url)
{
	getdir_jobs_counter++;
}

function parsing_jobs_ok(url)
{
	parsed_jobs_counter++;
}


function report_state() 
{
	logger.warn('dirs:(wait:%d -> done:%d Empty:%d)', getdir_queue_counter, getdir_jobs_counter, getdir_jobs_empty.length);
	logger.warn('files:(wait:%d -> done:%d)', parse_queue_counter, parsed_jobs_counter);
}


function redo_failure_jobs(job_list, max_count) 
{
	var result = max_count;
	var undone = job_list.filter(function(element, index, array) {
		return (element.result != 'done');
		});

	if (undone.length) {
		var wait_list = undone.filter(function(element, index ,array) {
			return (element.result == 'wait');
			});
		var send_list = undone.filter(function(element, index ,array) {
			return (element.result != 'wait');
			});

		var can_send = result - wait_list.length;

		if (can_send > 0) {
			job_list = wait_list;
			for (var i=0; i<send_list.length; i++, can_send--) {
				var job = send_list[i];
				if (can_send > 0) {
					result--;
					submit_job_command(job_list, job.sender);
				} else {
					job_list.push(job);
				}
			}
		} else {
			result = 0;
		}
	} 

	return (result);
}

function shift_waitque_to_submit(dequeue_wait, job_list, max_count) 
{
	for (var i=0; i<max_count; i++) {
		dequeue_wait(function(sender){
			if (sender) {
				submit_job_command(job_list, sender);
			}
		});
	}
}

setInterval(function () 
{
	client_tick_counter++;

	var maxdo_getdir = redo_failure_jobs(getdir_jobs, max_submited_dirs);
	shift_waitque_to_submit(dequeue_getdir, getdir_jobs, maxdo_getdir);

	var maxdo_parsing = redo_failure_jobs(parsing_jobs, max_submited_files);
	shift_waitque_to_submit(dequeue_parse, parsing_jobs, maxdo_parsing);

	if (client_tick_counter % 5 === 0) {
		report_state();
	}
}, 1000);

/*----------------------------------------------------
	web interface of restful
----------------------------------------------------*/

var server = restify.createServer();

server.use(restify.queryParser());
server.use(restify.bodyParser());
server.listen(parseInt(program.port), function() {
	logger.log('%s listening at %s', server.name, server.url);
});

server.get('/gearmand/:info', function (req, res, next) {
	var reply = {};
	reply.host = gm_host[0];
	reply.port = gm_host[1];
	res.json(reply);
	return next();
});

function def_result(err_reason, cmd_handle)
{
	if (cmd_handle) {
		var res_yes = {};
		res_yes.result = 'ok';
		res_yes.handle = cmd_handle;
		return (res_yes);
	} else {
		var res_no = {};
		res_no.result = 'no';
		res_no.reason = err_reason;
		return (res_no);
	}
}

server.get('/gearman/ftpdirToFiles', function (req, res, next) 
{
	var err_reason = 'parameter error!';
	var cmd_handle = '';

	do {
		if (!req.params.url) break;
		if (!req.params.encoding) break;
		if (!req.params.jobTimeout) break;
		if (!req.params.connectTimeout) break;

		var ftp_url = qs.unescape(req.params.url);

		logger.log('new gearman command: ftpdirToFiles');
		logger.log('target url: %s', ftp_url);
		logger.log('encoding: %s', req.params.encoding);
		logger.log('job_timeout: %s', req.params.jobTimeout);
		logger.log('connect_timeout: %s', req.params.connectTimeout);

		err_reason = 'handle logic error!';
		var sender = Sender(null, 'ftpdirToFiles', ftp_url, ftp_url, req.params.encoding, 
				req.params.jobTimeout, req.params.connectTimeout);
		cmd_handle = push_getdir_queue(sender);
	} while (false);

	res.json(def_result(err_reason, cmd_handle));
	return next();
});


server.put('/gearman/ftpdirToFiles', function (req, res, next) 
{
	var report_val = req.body;
	assert(report_val);
	var reporter = JSON.parse(report_val);
	assert(reporter);

	ftpdir_to_files_report(reporter);

	var res_yes = {};
	res_yes.result = 'ok';
	res_yes.handle = reporter.sender.handle;
	res.json(res_yes);
	return next();
});

server.put('/gearman/fileToDatabase', function (req, res, next) 
{
	var report_val = req.body;
	assert(report_val);
	var reporter = JSON.parse(report_val);
	assert(reporter);

	fileToDatabase_report(reporter);

	var res_yes = {};
	res_yes.result = 'ok';
	res_yes.handle = reporter.sender.handle;
	res.json(res_yes);
	return next();
});


/*----------------------------------------------------
	execute the gearman client command
----------------------------------------------------*/

function Sender(handle, func_name, ftp_ori, ftp_url, ftp_encoding, job_timeout, conn_timeout)
{
	var sender = {};
	sender.handle = handle;
	sender.func_name = func_name;
	sender.ftp_ori = ftp_ori;
	sender.ftp_url = ftp_url;
	sender.ftp_encoding = ftp_encoding;
	sender.job_timeout = job_timeout;
	sender.conn_timeout = conn_timeout;
	return sender;
}


function push_getdir_queue(sender)
{
	if (!sender.handle) {
		sender.handle = uuid.v4();
	}

	enqueue_getdir(sender);
	return (sender.handle);
}

function push_parse_queue(sender)
{
	if (!sender.handle) {
		sender.handle = uuid.v4();
	}

	enqueue_parse(sender);
	return (sender.handle);
}

function submit_job_command(job_list, sender) 
{
	var job = gm_client.submitJob(sender.func_name, JSON.stringify(sender));
	job_list.push(job);

	job.setTimeout(parseInt(sender.job_timeout));
	job.sender = JSON.parse(JSON.stringify(sender));
	job.result = 'wait';

	job.on("timeout", function() {
		this.result = 'timeout';
		logger.debug('Timeout: ' + this.sender.ftp_url);
	});

	job.on("error", function(err) {
		this.result = 'error';
		logger.debug("ERROR: " + err.message || err + ' ' + this.sender.ftp_url);
	});

	job.on("data", function(data) {
		this.result = 'done';
	}); 

	//how to destroy the 'job' object???
	job.on("end", function() {
	});
}

function ftpdir_to_files_report (report) 
{
	var sender 	= report.sender;
	var new_urls 	= report.urls;
	var new_dirs 	= report.dirs;
	var finish_url = sender.ftp_url;

	getdir_jobs_ok(finish_url);

	for (var i=0; i<new_dirs.length; i++) {
		var item = new_dirs[i];
		if (item) {
			sender.ftp_url = item;
			push_getdir_queue(sender);
		}
	}

	sender.func_name = 'fileToDatabase';

	for (var i=0; i<new_urls.length; i++) {
		var item = new_urls[i];
		if (item) {
			sender.ftp_url = item;
			push_parse_queue(sender);
		}
	}

	if ((new_urls.length === 0) && (new_dirs.length === 0)) {
		getdir_jobs_empty.push(finish_url);
	}
}


function fileToDatabase_report(report)
{
	var sender 	= report.sender;
	var finish_url = sender.ftp_url;

	parsing_jobs_ok(finish_url);
}




