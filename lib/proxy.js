'use strict';

var url = require('url');
var httpProxy = require('http-proxy');
var rewriteCookies = require('./proxy-rewrite-cookies');

var env = {
	noProxy: process.env.NO_PROXY || process.env.no_proxy,
	httpProxy: process.env.HTTP_PROXY || process.env.http_proxy,
	httpsProxy: process.env.HTTPS_PROXY || process.env.https_proxy,
	remoteLocation: process.env.REMOTE_LOCATION || process.env.remote_location
};

// inspired by https://github.com/request/request/blob/33cd9e297a00c5540e55778a24a706effc35434c/request.js#L169
function getProxyUri(uri) {

	if (uri.protocol === 'https:' && env.httpsProxy || uri.protocol === 'http:' && env.httpProxy) {

		if (env.noProxy) {
			var canonicalHost = uri.host.replace(/^\.*/, '.');
			var port = uri.port || (uri.protocol === 'https:' ? '443' : '80');

			var patterns = env.noProxy.split(',');
			for (var i = patterns.length - 1; i >= 0; i--) {
				var pattern = patterns[i].trim().toLowerCase();

				// don't use a proxy at all
				if (pattern === '*') {
					return null;
				}

				// Remove leading * and make sure to have exact one leading dot (.)
				pattern = pattern.replace(/^[\*]+/, '').replace(/^\.*/, '.');

				// add port if no specified
				if (pattern.indexOf(':') === -1) {
					pattern += ':' + port;
				}

				// if host ends with pattern, no proxy should be used
				if (canonicalHost.indexOf(pattern) === canonicalHost.length - pattern.length) {
					return null;
				}
			}
		}

		if (uri.protocol === 'https:' && env.httpsProxy) {
			return env.httpsProxy;
		} else if (uri.protocol === 'http:' && env.httpProxy) {
			return env.httpProxy;
		}
	}

	return null;
}


/**
 * @typedef {Object} UrlAndBasicAuth
 * @property {string} url - url without basic auth
 * @property {string} basicAuth auth part of url
 */

/**
 * Separates baic auth credentials from the originUrl.
 *
 * Many services support basic authentication as part of URLs. 
 * For example http://me:secret@myhost.com has credentials for user me with password secret.
 * The here used module #http-proxy however, doesn't supports this URL. Instead it requires
 * an extra option for basic auth.
 *
 * This method separates the basic auth from the originUrl.
 *
 * @param {string} originUrl original URL, which can contain basic auth
 * @returns {UrlAndBasicAuth}
 * }
 */
function separateBasicAuth(originUrl){
    var basicAuthPattern = /(http|https)\:\/\/(.+?)\:(.+?)@(.*)/g;
	var partsOfUrl=basicAuthPattern.exec(originUrl);
	if (partsOfUrl){
        // originalUrl has the basic auth:
		return {url: partsOfUrl[1]+'://'+partsOfUrl[4],
		        basicAuth: partsOfUrl[2]+':'+partsOfUrl[3]};
	} else {
        // originalUrl doesn't have the basic auth, just return:
		return {url: originUrl};
	}
}

function createUri(uriParam, pRemoteUri) {
	// parse the request url
	var urlPattern = /^\/(http|https)\/(.*)/;
	var parts = urlPattern.exec(uriParam);
	if (parts) {
		var baUrl=separateBasicAuth(parts[1] + '://' + parts[2]);
		var retUri=url.parse(baUrl.url);
		if (baUrl.basicAuth){
			retUri.basicAuth=baUrl.basicAuth;
		}
		return retUri;
	}

	//if no absolute url is provided, check for REMOTE_LOCATION (which itself must be an absolute url)
	if (!pRemoteUri) {
		return undefined;
	}

	var baRemoteUrl=separateBasicAuth(pRemoteUri);
	var remoteUri=url.parse(baRemoteUrl.url);
	if (baRemoteUrl.basicAuth){
		remoteUri.basicAuth=baRemoteUrl.basicAuth;
	}

	var uri = url.parse(uriParam); //actual url

	//mix both uri objects
	if (uri.pathname) {
		if ( '/' == remoteUri.pathname.substring(remoteUri.pathname.length-1)) {
			//remoteUri.pathname ends with /
			remoteUri.pathname = remoteUri.pathname + uri.pathname.substring(1);
		} else {
			remoteUri.pathname = remoteUri.pathname + uri.pathname;
		}
	}

	if (uri.query) {
		if (remoteUri.query) {
			remoteUri.query = remoteUri.query + (remoteUri.query.length > 0 ? '&' : '') + uri.query;
		} else {
			remoteUri.query = uri.query;
		}
	}

	return remoteUri;
}

function buildRequestUrl(uri) {
	var ret = uri.pathname;
	if (uri.query ) {
		ret += '?' + uri.query;
	}
	return ret;
}

module.exports = function (options) {

	var proxy = httpProxy.createProxyServer(options || {});

	return function (req, res, next) {
		var uri = createUri(req.url, env.remoteLocation);
		if (!uri || !uri.host) {
			next();
			return;
		}

		// change original request url to target url
		req.url = buildRequestUrl(uri);

		// change original host to target host
		req.headers.host = uri.host;

		// overwrite response headers
		res.orgWriteHead = res.writeHead;
		res.writeHead = function() {
			var cookies = rewriteCookies(res.getHeader('set-cookie'));
			res.setHeader('set-cookie', cookies);
			// call original writeHead function
			res.orgWriteHead.apply(res, arguments);
		};

		// get proxy for uri (if defined in env vars)
		var targetUri = getProxyUri(uri) || uri.protocol + '//' + uri.host;

		var requestOptions={
			target: targetUri
		};

		if (uri.basicAuth){
			requestOptions.auth=uri.basicAuth;
		};
		// proxy the request
		proxy.proxyRequest(req, res,requestOptions,
		function (err) {
			if (err) {
				next(err);
			}
		});

	};

};

//For testing
module.exports._createUri = createUri;
module.exports._buildRequestUrl = buildRequestUrl;
module.exports._env = env;
