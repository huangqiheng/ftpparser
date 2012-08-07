----------- 安装文档 -----------------

一、下载相关软件：

	wget http://nchc.dl.sourceforge.net/project/boost/boost/1.50.0/boost_1_50_0.tar.gz
	wget http://nodejs.org/dist/v0.6.12/node-v0.6.12.tar.gz
	wget http://download.slogra.com/gearman/gearmand-0.34.tar.gz
	wget http://redis.googlecode.com/files/redis-2.2.12.tar.gz
	wget http://git-core.googlecode.com/files/git-1.7.7.tar.gz

	wget https://github.com/ijonas/dotfiles/raw/master/etc/init.d/redis-server
	wget https://github.com/ijonas/dotfiles/raw/master/etc/redis.conf

二、基础软件环境安装：

1、安装git

	tar xzvf git-1.7.7.tar.gz
	cd git-1.7.7
	autoconf
	./configure
	make
	sudo make install

2、gearman源代码安装

2.1、安装依赖包：boost

	tar zxf boost_1_50_0.tar.gz && cd boost_1_50_0
	./bootstrap.sh
	./b2 install

2.2、安装依赖包：libevent

	非源代码安装：sudo yum -y install libevent libevent-devel

2.3、安装依赖包：kerbos client

2.3、要使用gcc高级版本

	yum install gcc44 gcc44-c++ libstdc++44-devel -y
	然后在环境变量里加入:
	export CC=/usr/bin/gcc44
	export CXX=/usr/bin/g++44

2.4、安装gearman：

	tar zxf gearmand-0.34.tar.gz && cd gearmand-0.34
	./configure
	make 
	sudo make install

3、安装redis

3.1、安装程序

	tar -zxf redis-2.2.12.tar.gz
	cd redis-2.2.12
	make
	sudo make install


3.2、建立用户和日志

	sudo useradd redis
	mkdir -p /var/lib/redis
	mkdir -p /var/log/redis

3.3、配置init脚本

	vim /etc/sysctl.conf
	vm.overcommit_memory = 1
	sysctl -p

	wget https://github.com/ijonas/dotfiles/raw/master/etc/redis.conf
	修改redis.conf：
	really-use-vm yes
	bind 127.0.0.1
	dir /var/lib/redis
	logfile /var/log/redis/redislog
	sudo mv redis.conf /etc/redis.conf

	sudo vim /etc/init.d/redis-server
	#!/bin/bash 
	# 
	# Init file for redis 
	# 
	# chkconfig: - 80 12 
	# description: redis daemon 
	# 
	# processname: redis 
	# config: /etc/redis.conf 
	# pidfile: /var/run/redis.pid 
	source /etc/init.d/functions 
	#BIN="/usr/local/bin" 
	BIN="/usr/local/bin" 
	CONFIG="/etc/redis.conf" 
	PIDFILE="/var/run/redis.pid" 
	### Read configuration 
	[ -r "$SYSCONFIG" ] && source "$SYSCONFIG" 
	RETVAL=0 
	prog="redis-server" 
	desc="Redis Server" 
	start() { 
		if [ -e $PIDFILE ];then 
			echo "$desc already running...." 
				exit 1 
				fi 
				echo -n $"Starting $desc: " 
				daemon $BIN/$prog $CONFIG 
				RETVAL=$? 
				echo 
				[ $RETVAL -eq 0 ] && touch /var/lock/subsys/$prog 
				return $RETVAL 
	} 
	stop() { 
		echo -n $"Stop $desc: " 
			killproc $prog 
			RETVAL=$? 
			echo 
			[ $RETVAL -eq 0 ] && rm -f /var/lock/subsys/$prog $PIDFILE 
			return $RETVAL 
	} 
	restart() { 
		stop 
			start 
	} 
	case "$1" in 
	start) 
	start 
	;; 
	stop) 
	stop 
	;; 
	restart) 
	restart 
	;; 
	condrestart) 
	[ -e /var/lock/subsys/$prog ] && restart 
	RETVAL=$? 
	;; 
	status) 
	status $prog 
	RETVAL=$? 
	;; 
	*) 
	echo $"Usage: $0 {start|stop|restart|condrestart|status}" 
	RETVAL=1 
	esac 
	exit $RETVAL


4、mysql安装

4.1、源代码安装mysql

4.2、创建数据库

	CREATE DATABASE gearman;
	USE gearman;
	CREATE TABLE jobdone(
			uri char(128) NOT NULL,
			time timestamp DEFAULT NOW()
			);

	CREATE UNIQUE INDEX uri_index ON jobdone(uri);

	GRANT ALL PRIVILEGES ON gearman.* TO jobdone@"%" IDENTIFIED BY 'jobs2jobs' WITH GRANT OPTION;
	GRANT ALL PRIVILEGES ON gearman.* TO jobdone@localhost IDENTIFIED BY 'jobs2jobs' WITH GRANT OPTION;


5、curl和iconv安装

	一般操作系统自带，不需要特别安装

6、nodejs安装


三、安装项目所需的js包

	sudo npm install commander
	sudo npm install forever
	sudo npm install mysql
	sudo npm install node-uuid
	sudo npm install restify
	sudo npm install tracer
	sudo npm install csv
	sudo npm install hiredis
	sudo npm install node-gearman
	sudo npm install redis
	sudo npm install sprintf



