#!/usr/bin/env node

var fs = require('fs');
var qs = require('querystring');
var path = require('path');
var csv = require('csv');
var assert = require('assert');
var Gearman = require("node-gearman"); //need to install
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var restify = require('restify');  //need to install
var program = require('commander');  //need to install
var sprintf = require('sprintf').sprintf;  //need to install

var log_path = __dirname + '/log';
var logger = require('tracer').dailyfile({root:log_path, format : "{{timestamp}} <{{title}}> {{message}}", dateformat : "HH:MM:ss"});
if (!path.existsSync(log_path)) {
	fs.mkdirSync(log_path, 0755);
}

/*----------------------------------------------------
	handle the command line parameters
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

/*----------------------------------------------------
	analyse the download result of the directorys
----------------------------------------------------*/
function parse_csv_result(ftp_url, csv_src, new_dir_cb, new_file_cb, err_cb, end_cb) 
{
	var csved = csv();
	csved.from(csv_src, {delimiter:' '});

	csved.transform(function(data) {
		var newdata = data.filter(function(element, index, array) {
			return (element != '');
		});
		return newdata;
	});

	csved.on('data', function(data, index) {
		var file_name = data[data.length - 1];

		if (data[1] == '1') {
			new_file_cb(ftp_url + file_name);
		} else {
			file_name = ftp_url + file_name + '/';
			new_dir_cb(file_name);
		}
	});
		
	csved.on('end', function(count) {
		end_cb(count);
	});

	csved.on('error', function(error) {
		logger.debug('csv error: ' + error.message);
		err_cb(error);
	});
}


/*----------------------------------------------------
	make gb2312 string of encodeUrl like
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
	convert string characters, use iconv
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
	user shell command of curl and iconv
	to download the directories
----------------------------------------------------*/
function curl_iconv(curl_opt, iconv_opt, done_cb) 
{
	var i_from = iconv_opt.indexOf('-f');
	var i_to = iconv_opt.indexOf('-t');

	if ((i_from == -1) || (i_from+1 >= iconv_opt.length) 
		|| (i_to == -1) || (i_to+1 >= iconv_opt.length)) {
		done_cb(1, null, 'iconv parameter error!');
		return;
	}
	
	var is_need_iconv = (iconv_opt[++i_from] != iconv_opt[++i_to]);

	var curl_p    = spawn('curl', curl_opt);
	var iconv_p   = is_need_iconv && spawn('iconv', iconv_opt);

	var stderr_all = '';
	var stdout_all = '';
	var stdout_curl = '';

	curl_p.stdout.on('data', function (data) {
		stdout_curl += data;
		if (is_need_iconv) {
			iconv_p.stdin.write(data);
		} else {
			stdout_all += data;
		}
	});

	curl_p.stderr.on('data', function (data) {
		stderr_all += data;
	});

	curl_p.on('exit', function (code) {
		if (code !== 0) {
			logger.debug('curl process exited with code ' + code);
			logger.debug(stderr_all);
		}

		if (is_need_iconv) {
			iconv_p.stdin.end();
			iconv_p.kill();
		}

		done_cb(code, stdout_all, stderr_all);
	});


	if (!is_need_iconv) {
		return;
	}

	iconv_p.stdout.on('data', function (data) {
		stdout_all += data;
	});

	iconv_p.stderr.on('data', function (data) {
		stderr_all += data;
	});

	iconv_p.on('exit', function (code) {
		if (code !== 0) {
			logger.debug('iconv process exited with code ' + code);
		}
		done_cb(code, stdout_all, stderr_all);
	});
}


/*----------------------------------------------------
	use curl to download
	and analyse results.
----------------------------------------------------*/
function curl_ftp_dir (request, new_dir_cb, new_file_cb, err_cb, end_cb) 
{
	iconv_convert(request.ftp_url, 'utf8', request.ftp_encoding, function (code, data, error) {
		if (code !== 0) {
			err_cb(error);
		}
	
		logger.debug('working on(' + data+ ')');
		var new_url = gb2312_url(data);
		logger.debug('gb2312_url cmd: ' + new_url);

		var curl_opt = ['--verbose', '--trace-time', '-s', '--url', new_url, 
				'--connect-timeout', request.conn_timeout];
		var iconv_opt = ['-f', request.ftp_encoding, '-t', 'utf8', '--verbose'];



		var curl_iconv_timeout_id = setTimeout(function() {
			throw new Error('curl_iconv timeout!');
		}, request.conn_timeout * 2 * 1000);

		curl_iconv(curl_opt, iconv_opt, function (code, stdout, stderr) {
			clearTimeout(curl_iconv_timeout_id);

			if (code !== 0) {
				err_cb(stderr);
				return;
			}

			if (stdout) {
				logger.log('\n'+stdout);
				parse_csv_result(request.ftp_url, stdout, new_dir_cb, new_file_cb, err_cb, end_cb);
				return;
			}	

			logger.debug(stderr);

			if (stderr.lastIndexOf('* Closing connection #0') == -1) {
				err_cb(stderr);
			} else {
				logger.debug('check as ok.');
				logger.debug('is it real a empty dir?');
				end_cb(0);
			}
		});
	});
};


/*----------------------------------------------------
	application main entry
	regist gearman worker
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

			var reply_files = [];
			var reply_dirs = [];

			curl_ftp_dir(sender, function (new_dir) {
					reply_dirs.push(new_dir);
				}, function (new_file) {
					reply_files.push(new_file);
				}, function (err) {
					no_counter++;
					logger.debug(err);
					logger.debug('job error: ' + sender.ftp_url);
					logger.debug('reset! waitting for next job.');
					print_counter();
					worker.error();
				}, function (succ_count) {
					var report = {};
					report.sender = sender;
					report.urls = reply_files;
					report.dirs = reply_dirs;

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


