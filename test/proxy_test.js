/*eslint-env mocha */
'use strict';

var http = require('http');
var assert = require('assert');
var connect = require('connect');
var proxy = require('../').proxy;

describe('proxy middleware should proxy generic requests', function () {
	it('should proxy from one server to the other', function (done) {
		var sExpectedResponse = 'All ok!',
			sExpectedPath = '/foo/bar',
			iExpectedStatusCode = 200,
			oAppToBeProxied = connect(),
			sActualResponse = '',
			sActualPath,
			iActualStatusCode;

		oAppToBeProxied.use(function (oRequest, oResponse) {
			// no x-forwareded headers expected (wasn't configured in proxy)
			assert.equal(oRequest.headers['x-forwarded-for'], undefined);
			assert.equal(oRequest.headers['x-forwarded-port'], undefined);
			assert.equal(oRequest.headers['x-forwarded-proto'], undefined);
			assert.equal(oRequest.headers['authorization'], undefined, 'no basic auth expected');
			sActualPath = oRequest.url;
			oResponse.setHeader('Set-Cookie', [
				'a=b; Secure; HttpOnly; Max-Age=5; SameSite=Strict',
				'c=d; Domain=example.com; HttpOnly; Expires=expires=Fri, 09-Oct-2020 10:00:00 GMT; Path=/foo'
			]);
			oResponse.end(sExpectedResponse);
		});

		var oServerToBeProxied = http.createServer(oAppToBeProxied);
		oServerToBeProxied.listen(8080);

		var oProxyApp = connect();
		oProxyApp.use(proxy());
		var oProxyServer = http.createServer(oProxyApp);
		oProxyServer.listen(9000);

		http.get('http://localhost:9000/http/localhost:8080' + sExpectedPath, function (oResponse) {
			oResponse.on('data', function(oData) {
				sActualResponse += oData;
			});
			iActualStatusCode = oResponse.statusCode;
			oResponse.on('end', function () {
				assert.equal(sActualPath, sExpectedPath);
				assert.equal(sActualResponse, sExpectedResponse);
				assert.equal(iActualStatusCode, iExpectedStatusCode);

				var cookies = this.headers['set-cookie'];
				['secure', 'domain', 'path', 'samesite'].forEach(function(attribute) {
					var hasAttribute = cookies.some(function(cookie) {
						return cookie.toLowerCase().includes(attribute);
					});
					assert.ok(!hasAttribute, attribute + ' attribute should be removed from the cookies');
				});

				oServerToBeProxied.close();
				oProxyServer.close();
				done();
			});
		});
	});
	it('should proxy by respecting custom options', function (done) {
		var sExpectedResponse = 'All ok!',
		sExpectedPath = '/foo/bar',
		iExpectedStatusCode = 200,
		oAppToBeProxied = connect(),
		sActualResponse = '',
		sActualPath,
		iActualStatusCode;

		oAppToBeProxied.use(function (oRequest, oResponse) {
			// x-forwareded headers are expected (see xfwd option in proxy config)
			assert(oRequest.headers['x-forwarded-for'] === '127.0.0.1' || oRequest.headers['x-forwarded-for'] === '::ffff:127.0.0.1');
			assert.equal(oRequest.headers['x-forwarded-port'], '8080');
			assert.equal(oRequest.headers['x-forwarded-proto'], 'http');
			sActualPath = oRequest.url;
			oResponse.end(sExpectedResponse);
		});

		var oServerToBeProxied = http.createServer(oAppToBeProxied);
		oServerToBeProxied.listen(8080);

		var oProxyApp = connect();
		oProxyApp.use(proxy({
			xfwd: true
		}));
		var oProxyServer = http.createServer(oProxyApp);
		oProxyServer.listen(9000);

		http.get('http://localhost:9000/http/localhost:8080' + sExpectedPath, function (oResponse) {
			oResponse.on('data', function(oData) {
				sActualResponse += oData;
			});
			iActualStatusCode = oResponse.statusCode;
			oResponse.on('end', function () {
				assert.equal(sActualPath, sExpectedPath);
				assert.equal(sActualResponse, sExpectedResponse);
				assert.equal(iActualStatusCode, iExpectedStatusCode);

				oServerToBeProxied.close();
				oProxyServer.close();
				done();
			});
		});
	});


	it('should support basic auth', function (done) {
		var sExpectedResponse = 'All ok!',
		sExpectedPath = '/foo/bar',
		iExpectedStatusCode = 200,
		oAppToBeProxied = connect(),
		sActualResponse = '',
		sActualPath,
		iActualStatusCode;

		oAppToBeProxied.use(function (oRequest, oResponse) {
			// x-forwareded headers are expected (see xfwd option in proxy config)
			assert.equal(oRequest.headers['authorization'], 'Basic bWU6cHdk');
			oResponse.end(sExpectedResponse);
		});

		var oServerToBeProxied = http.createServer(oAppToBeProxied);
		oServerToBeProxied.listen(8080);

		var oProxyApp = connect();
		oProxyApp.use(proxy({
			xfwd: true
		}));
		var oProxyServer = http.createServer(oProxyApp);
		oProxyServer.listen(9000);

		http.get('http://localhost:9000' + '/http/me:pwd@localhost:8080?who=you&no', function (oResponse) {
			oResponse.on('data', function(oData) {
				sActualResponse += oData;
			});
			iActualStatusCode = oResponse.statusCode;
			oResponse.on('end', function () {

				oServerToBeProxied.close();
				oProxyServer.close();
				done();
			});
		});
	});

});

