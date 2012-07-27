#!/usr/bin/env node

var assert = require('assert');
var logger = require('tracer').colorConsole();
var program = require('commander');
var restify = require('restify');
var uuid = require('node-uuid'); //安装
var Gearman = require("node-gearman");
var qs = require('querystring');

/*----------------------------------------------------
   处理命令行
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
   程序初始化，和守护函数
----------------------------------------------------*/

var gm_client = new Gearman(gm_host[0], gm_host[1]);

var gm_jobs = [];
var url_done = [];
var dir_done = [];
var empty_dirs = [];

var client_tick_couter = 0;

setInterval(function () {
	client_tick_couter++;

	var undone = gm_jobs.filter(function(element, index, array) {
		return (element.result != 'done');
		});

	if (undone.length) {
		var null_list = undone.filter(function(element, index ,array) {
			return (element.result == 'null');
			});
		var send_list = undone.filter(function(element, index ,array) {
			return (element.result != 'null');
			});

		var count = 0;
		if (client_tick_couter % 5 === 0) {
			print_counter('unfinish jobs: ' + (null_list.length));

			if (client_tick_couter % 30 === 0) {
				for (var i=0; i<null_list.length; i++) {
					var job = null_list[i];
					logger.log('  ['  + (++count) + ':' + job.result + '] ' + job.sender.ftp_url);
				}
			}
		}

		count = 0;
		gm_jobs = null_list;
		for (var i=0; i<send_list.length; i++) {
			if (count == 0) {
				logger.trace('list reset jobs: ' + (send_list.length));
			}
			var job = send_list[i];
			submit_job_command(job.sender);
			logger.trace('  ['  + (++count) + ':' + job.result + '] ' + job.sender.ftp_url);
		}
	} 
	else 
	{
		if ((url_done.length) && (dir_done.length)) {
			if (client_tick_couter % 5 === 0) {
				logger.log('all completed:  urls(%d) dirs(%d) empty(%d)', url_done.length, dir_done.length, empty_dirs.length);
				print_counter('counter report');
			}
		
			if (client_tick_couter % 30 === 0) {
				for (var i=0; i<empty_dirs.length; i++) {
					if (i === 0) {
						logger.debug('empty dirs:');
					}
					logger.debug('  ['  + i + '] ' + empty_dirs[i]);
				}
			}
			//process.exit(0);
		}
	}

}, 1000);

/*----------------------------------------------------
  web接口 
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
		cmd_handle = submit_job_command(sender);
	} while (false);

	res.json(def_result(err_reason, cmd_handle));
	return next();
});


server.put('/gearman/ftpdirToFiles', function (req, res, next) 
{
	var err_reason = 'parameter error!';
	var cmd_handle = '';

	do {
		var report_val = req.body;
		if (!report_val) break;

		err_reason = 'parmaeter type error!';
		if (typeof report_val != 'string') break;

		err_reason = 'parmaeter parser error!';
		var reporter = JSON.parse(report_val);
		if (!reporter) break;

		cmd_handle = ftpdir_to_files_report(reporter);
	} while (false);

	res.json(def_result(err_reason, cmd_handle));
	return next();
});

server.put('/gearman/fileToDatabase', function (req, res, next) 
{
	var err_reason = 'parameter error!';
	var cmd_handle = '';

	do {
		var report_val = req.body;
		if (!report_val) break;

		err_reason = 'parmaeter format error!';
		if (typeof report_val != 'string') break;

		var reporter = JSON.parse(report_val);
		cmd_handle = fileToDatabase_report(reporter);
	} while (false);

	res.json(def_result(err_reason, cmd_handle));
	return next();
});


/*----------------------------------------------------
  执行gearman client命令
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

var submit_counter = 0;
var report_counter = 0; 

function print_counter(msg)
{
	logger.log('(submit:%d, report:%d) %s', submit_counter, report_counter, msg);
}

function submit_job_command(sender) 
{
	if (!sender.handle) {
		sender.handle = uuid.v4();
	}

	logger.log(sender);

	var job = gm_client.submitJob(sender.func_name, JSON.stringify(sender));
	gm_jobs.push(job);

	submit_counter++;

	job.setTimeout(parseInt(sender.job_timeout));
	job.sender = Sender(sender.handle, sender.func_name, sender.ftp_ori, sender.ftp_url,
				sender.ftp_encoding,sender.job_timeout,sender.conn_timeout);
	job.result = 'null';

	job.on("timeout", function() {
		this.result = 'timeout';
		logger.debug('Timeout: ' + this.sender.ftp_url);
	});

	job.on("error", function(err) {
		this.result = 'error';
		logger.debug("ERROR: " + err.message || err + ' ' + this.sender.ftp_url);
	});

	//这个时候，job完成了，意味着worker已经成功ftpdir_to_files_report将结果投递
	job.on("data", function(data) {
		this.result = 'done';
	}); 

	job.on("end", function() {
		logger.debug('job end(' + this.result + '): ' + this.sender.ftp_url);
	});

	return (sender.handle);
}

function ftpdir_to_files_report (report) 
{
	var sender 	= report.sender;
	var new_urls 	= report.urls;
	var new_dirs 	= report.dirs;
	var finish_url = sender.ftp_url;

	report_counter++;
	dir_done.push(finish_url);

	//将新发现的目录，递归新请求
	for (var i=0; i<new_dirs.length; i++) {
		var item = new_dirs[i];
		if (item) {
			sender.ftp_url = item;
			submit_job_command(sender);
		}
	}

	//将新发现的文件，接着请求新命令

	for (var i=0; i<new_urls.length; i++) {
		var item = new_urls[i];
		if (item) {
			url_done.push(item);
			fileToDatabase_command(sender);
		}
	}

	//记录空目录
	if ((new_urls.length === 0) && (new_dirs.length === 0)) {
		empty_dirs.push(finish_url);
	}

	logger.debug('(dir:%d file:%d empty:%d) %s', dir_done.length, url_done.length, empty_dirs.length, finish_url);
	return (sender.handle);
}

function fileToDatabase_command(sender)
{


	return (sender.handle);
}

function fileToDatabase_report(report)
{
	var sender 	= report.sender;

	return (sender.handle);
}




