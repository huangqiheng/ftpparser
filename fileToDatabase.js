#!/usr/bin/env node

var qs = require('querystring');
var path = require('path');
var fs = require('fs');
var csv = require('csv');
var assert = require('assert');
var Gearman = require("node-gearman"); //need to install
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var restify = require('restify');  //need to install
var program = require('commander');  //need to install
var sprintf = require('sprintf').sprintf;  //need to install
var uuid = require('node-uuid'); //need to install

var log_path = __dirname + '/log';
var logger = require('tracer').dailyfile({root:log_path, format : "{{timestamp}} <{{title}}> {{message}}", dateformat : "HH:MM:ss"});
if (!path.existsSync(log_path)) {
	fs.mkdirSync(log_path, 0755);
}

/*----------------------------------------------------
	handle command line
----------------------------------------------------*/

program	.version('0.0.1')
	.option('-h, --host [ip:port]', 'master host(TCP)', '127.0.0.1:8080')
	.parse(process.argv);

function split_host(val, default_port) {
	var ret = val.split(':');
	if (ret.length == 1) {
		ret.push(default_port);
	}
	return ret;
}

var master_host = split_host(program.host, '8080');
var master_url = 'http://'+master_host[0]+':'+master_host[1];
var func_name = path.basename(__filename, '.js');

var down_path = __dirname + '/tempdown';

if (!path.existsSync(down_path)) {
	fs.mkdirSync(down_path, 0755);
}


/*----------------------------------------------------
  change to gb2312 character of encodeUrl
----------------------------------------------------*/
function gb2312_url(str)
{ 
	var strOut=""; 
	for(var i = 0; i < str.length; i++){ 
		var c = str.charAt(i); 
		var code = str.charCodeAt(i); 

		var is_spectial_char = ('~!@#$%^&*()-_+={}[]|\\:;"\'<>,.?/`'.indexOf(c) != -1);
		var is_numchar = ('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'.indexOf(c) != -1);
		
		if (is_spectial_char || is_numchar) {
			strOut += c;
			continue;
		}

		strOut += "%" + parseInt(c,16); 
	} 
	return strOut; 
}

/*----------------------------------------------------
	iconv: convert character
----------------------------------------------------*/
function iconv_convert(input, from, to, done_cb) 
{
	if (from == to) {
		done_cb(0, input, '');
		return;
	}

	var out_data = '';
	var err_data = '';

	iconv_p = spawn('iconv', ['-f', from, '-t', to]);
	iconv_p.stdin.write(input);
	iconv_p.stdin.end();

	iconv_p.stdout.on('data', function (data) {
		out_data += data;
	});

	iconv_p.stderr.on('data', function (data) {
		err_data += data;
	});

	iconv_p.on('exit', function(code) {
		done_cb(code, out_data, err_data);
	});
}

/*----------------------------------------------------
	use curl to download, shell method
----------------------------------------------------*/
function curl_download(curl_opt, done_cb) 
{
	var curl_p    = spawn('curl', curl_opt);

	var stderr_all = '';
	var stdout_all = '';

	curl_p.stdout.on('data', function (data) {
		stdout_all += data;
	});

	curl_p.stderr.on('data', function (data) {
		stderr_all += data;
	});

	curl_p.on('exit', function (code) {
		if (code !== 0) {
			logger.debug('curl process exited with code ' + code);
			logger.debug(stderr_all);
		}

		done_cb(code, stdout_all, stderr_all);
	});
}


/*----------------------------------------------------
	curl download
	analiyz the result
----------------------------------------------------*/
function send_curl_request(request, err_cb, end_cb) 
{
	iconv_convert(request.ftp_url, 'utf8', request.ftp_encoding, function (code, data, error) {
		if (code !== 0) {
			err_cb(error);
		}
	
		logger.debug('working on(' + data+ ')');
		var new_url = gb2312_url(data);
		logger.debug('gb2312_url cmd: ' + new_url);

		var output_file = down_path + '/'+ uuid.v4();

		var curl_opt = ['--verbose', 
				'--url', new_url, 
				'-o', output_file,
				'--connect-timeout', request.conn_timeout];

		var curl_timeout_id = setTimeout(function() {
			throw new Error('curl_iconv timeout!');
		}, request.conn_timeout * 3 * 1000);

		curl_download(curl_opt, function (code, stdout, stderr) {
			clearTimeout(curl_timeout_id);

			if (code !== 0) {
				err_cb(stderr);
				return;
			}

			if (stderr.lastIndexOf('* Closing connection #0') == -1) {
				err_cb(stderr);
			} else {
				end_cb(stdout, stderr);
			}
		});
	});
};


/*----------------------------------------------------
	application main
	regist the gearman worker
----------------------------------------------------*/
var recv_counter = 0;
var ok_counter = 0;
var no_counter = 0;

function print_counter()
{
	logger.log('recv:%d, ok:%d, no:%d', recv_counter, ok_counter, no_counter);
}

function main_worker(master, func_name)
{
	var json_cli = restify.createJsonClient({
		url: master,
		version: '*'
	});

	json_cli.get('/gearmand/host', function(err, req, res, gm_host) {
		assert.ifError(err);
		logger.log('gearman server:: %s : %s', gm_host.host, gm_host.port);

		var gm_worker = new Gearman(gm_host.host, gm_host.port);
		logger.trace('registerWorker: ' + func_name);

		gm_worker.registerWorker(func_name, function(payload, worker) {
			recv_counter++;

			if(!payload){
				no_counter++;
				worker.error();
				logger.debug('error payload == NULL');
				print_counter();
				return;
			}

			var sender = JSON.parse(payload);

			assert(sender.handle);
			assert(sender.ftp_ori);
			assert(sender.ftp_url);
			assert(sender.ftp_encoding);
			assert(sender.conn_timeout);

			send_curl_request(sender, function (err) {
					no_counter++;
					logger.debug(err);
					logger.debug('job error: ' + sender.ftp_url);
					logger.debug('reset! waitting for next job.');
					print_counter();
					worker.error();
				}, function (stdout, stderr) {
					var report = {};
					report.sender = sender;
					report.stdout = stdout;
					report.stderr = stderr;

					logger.trace('send rest report, waiting...');
					logger.log(report);

					json_cli.put('/gearman/'+func_name, report, function(err, req, res, reply) {
						assert.ifError(err);
						clearTimeout(timeout_id);
						logger.log(reply);

						if (reply.result == 'ok') {
							ok_counter++;
							logger.trace('replied ok! waitting for next job.');
							print_counter();
							worker.end('ok');
						} else {
							logger.trace('report error: %s', reply.reason);
							no_counter++;
							logger.trace('replied no! waitting for next job.');
							print_counter();
							worker.error();
						}
					});

					var timeout_id = setTimeout(function() {
						logger.trace('XXXXX <----------  send report timeout, clear for next job --------> XXXXX');
						no_counter++;
						print_counter();
						worker.error();
					}, 5000);
				}
			);
		});

	});
}

main_worker (master_url, func_name);


