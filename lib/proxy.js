#!/usr/bin/env node

var http = require('http');
var util = require('util');
var fs = require('fs');
var url = require('url');
var path = require('path');
var log = require('color-log');
var httpProxy = require('http-proxy');
var optimist = require('optimist');
var dns = require('dns');

var mimeTypes = {
    "html": "text/html",
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "js": "text/javascript",
    "css": "text/css"
};

var DEFAUALT_CONFIG = {
    proxyPort: 8888
};


var argv = optimist.usage([
	'Usage:',
	'     $0 [-c] CONFIG_FILE',
	'     $0 [-p PORT] [-s STATIC]',
	''
].join('\n')).
	default('p', DEFAUALT_CONFIG.port).
	alias('p', 'port').
	alias('h', 'help').
	alias('s', 'static').
	describe('c', 'Use configuration file').
	describe('p', 'Proxy port for listen').
	describe('s', 'Static content directory served by proxy').
	describe('h', 'Show usage documentation');

var opts = argv.argv;
/**
 * help
 */
if (opts.h) {
    console.log(argv.help());
    process.exit(0);
}

/**
 * [parse confFile]
 */
var confFile = opts.c || './proxy.json';
var conf = {};

if (confFile) {
	confFile = path.resolve(confFile);
	try {
	    conf = JSON.parse(fs.readFileSync(confFile, {
	        encoding: 'utf-8'
	    }));
	} catch(e) {
		log.error('加载配置文件错误');
		log.error(e);
		process.exit(0);
	}
	log.info('加载代理配置：' + confFile);
}

conf.port = opts.port || DEFAUALT_CONFIG.proxyPort;
conf.hosts = conf.hosts || {};
conf.static = conf.static || __dirname;

log.info(conf);

startProxy(conf);

/**
 * [startProxy description]
 * @param  {[type]} proxyTargets [description]
 * @return {[type]}              [description]
 */
function startProxy(proxyConfig) {
	var proxy = httpProxy.createServer({});  
  
	// 捕获异常  
	proxy.on('error', function (err, req, res) {  
	  res.writeHead(500, {  
	    'Content-Type': 'text/plain'  
	  });  
	  log.error(err);
	  res.end('Something went wrong. And we are reporting a custom error message.');  
	});

	proxy.on('proxyRes', function (proxyRes, req, res) {
		// log.info('RAW Response from the target', proxyRes.headers);
	});


	var server = require('http').createServer(function(req, res) {
		// find host name
		var host = req.headers.host,
			ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

		var uri = url.parse(req.url).pathname;

		/**
		 * 如果在代理列表里边，按配置转发
		 */
		var matchResult = matchUri(host, uri);
		if (matchResult.matched) {
			var localFilePath = path.resolve(proxyConfig.static, matchResult.target)
			log.info( host + req.url , '   ->   ' + localFilePath);

			serveStatic(req, res, localFilePath);
		}

		/**
		 * 访问线上服务
		 * @type {[type]}
		 */
		else {

			var ip = proxyConfig.hosts[host];
			if (!ip) {
				// @TODO: host 带端口的情况处理
				dns.resolve4(host, function(err, addresses) {
					if (err) {
						log.error('error', err);
					} else {
						log.info('addresses', addresses);
						doProxy(addresses[0]);
					}
				});
			} else {
				doProxy(ip);
			}
		}
		

		/**
		 * [doProxy description]
		 * @param  {[type]} ip [description]
		 * @return {[type]}    [description]
		 */
		function doProxy(ip) {
			var target = 'http://' + ip;
			// var target = 'http://10.0.3.2/index.html';
			log.info( host + req.url , '   ->   ' + target);
			proxy.web(req, res, {target: target});
		}

		/**
		 * match uri
		 * @param  {[type]} uri [description]
		 * @return {[type]}     [description]
		 */
		function matchUri(host, uri) {
			var target = proxyConfig.target;
			var ret = {
				matched: false,
				target: ''
			};

			var list = target[host];
			// log.warn(list);
			if (list) {
				var keys = Object.keys(list);
				keys.forEach(function(key) {
					var reg = new RegExp(key);
					var result = reg.exec(uri);
					if (result) {
						ret = {
							matched: true,
							target: list[key],
							matches: result
						};

						for (var i = 0; i < result.length; i++) {
							ret.target = ret.target.replace('$' + i, result[i]);
						}
						
						return false;
					}
				});
			}

			return ret;
		}

	});
	log.info('代理服务器成功运行在' + proxyConfig.port + '端口');

	server.listen(proxyConfig.port);
}

/**
 * [serveStatic description]
 * @return {[type]} [description]
 */
function serveStatic(req, res, filename) {
    fs.exists(filename, function(exists) {
        if(!exists) {
            log.error("not exists: " + filename);
            res.writeHead(200, {'Content-Type': 'text/plain'});
            res.write('404 Not Found\n');
            res.end();
        }

        var mimeType = mimeTypes[path.extname(filename).split(".")[1]];
        res.writeHead(200, mimeType);

        var fileStream = fs.createReadStream(filename);
        fileStream.pipe(res);
    });
}

process.on('uncaughtException', function(err) {
  log.error(err);
});




