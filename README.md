----------- 安装文档 -----------------

一、下载相关软件：

	wget http://nchc.dl.sourceforge.net/project/boost/boost/1.50.0/boost_1_50_0.tar.gz
	wget http://nodejs.org/dist/v0.6.12/node-v0.6.12.tar.gz
	wget http://download.slogra.com/gearman/gearmand-0.34.tar.gz
	wget http://redis.googlecode.com/files/redis-2.2.12.tar.gz

	wget https://github.com/ijonas/dotfiles/raw/master/etc/init.d/redis-server
	wget https://github.com/ijonas/dotfiles/raw/master/etc/redis.conf

二、基础软件环境安装：

1、gearman源代码安装

	1.1、安装依赖包：boost

		tar zxf boost_1_50_0.tar.gz && cd boost_1_50_0
		./bootstrap.sh
		./b2 install

	1.2、安装依赖包：libevent

		非源代码安装：sudo yum -y install libevent libevent-devel

	1.3、安装依赖包：kerbos client

	1.3、要使用gcc高级版本

		yum install gcc44 gcc44-c++ libstdc++44-devel -y
		然后在环境变量里加入:
		export CC=/usr/bin/gcc44
		export CXX=/usr/bin/g++44

	1.4、安装gearman：

		tar zxf gearmand-0.34.tar.gz && cd gearmand-0.34
		./configure
		make 
		sudo make install

2、安装redis

	2.1、安装程序

		tar -zxf redis-2.2.12.tar.gz
		cd redis-2.2.12
		make
		sudo make install

	2.2、配置init脚本

		wget https://github.com/ijonas/dotfiles/raw/master/etc/init.d/redis-server
		wget https://github.com/ijonas/dotfiles/raw/master/etc/redis.conf
		sudo mv redis-server /etc/init.d/redis-server
		sudo chmod +x /etc/init.d/redis-server
		sudo mv redis.conf /etc/redis.conf

3、mysql安装

	1.1、源代码安装mysql

	1.2、创建数据库

		CREATE DATABASE gearman;
		USE gearman;
		CREATE TABLE jobdone(
				uri char(128) NOT NULL,
				time timestamp DEFAULT NOW()
				);

		CREATE UNIQUE INDEX uri_index ON jobdone(uri);

		GRANT ALL PRIVILEGES ON gearman.* TO jobdone@"%" IDENTIFIED BY 'jobs2jobs' WITH GRANT OPTION;
		GRANT ALL PRIVILEGES ON gearman.* TO jobdone@localhost IDENTIFIED BY 'jobs2jobs' WITH GRANT OPTION;


4、curl和iconv安装

	一般操作系统自带，不需要特别安装

5、nodejs安装


三、安装项目所需的js包

sudo npm install https://github.com/huangqiheng/ftpparser.git



