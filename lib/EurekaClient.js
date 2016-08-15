'use strict';

exports.__esModule = true;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _request = require('request');

var _request2 = _interopRequireDefault(_request);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _jsYaml = require('js-yaml');

var _jsYaml2 = _interopRequireDefault(_jsYaml);

var _merge = require('lodash/merge');

var _merge2 = _interopRequireDefault(_merge);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _async = require('async');

var _events = require('events');

var _AwsMetadata = require('./AwsMetadata');

var _AwsMetadata2 = _interopRequireDefault(_AwsMetadata);

var _ConfigClusterResolver = require('./ConfigClusterResolver');

var _ConfigClusterResolver2 = _interopRequireDefault(_ConfigClusterResolver);

var _DnsClusterResolver = require('./DnsClusterResolver');

var _DnsClusterResolver2 = _interopRequireDefault(_DnsClusterResolver);

var _Logger = require('./Logger');

var _Logger2 = _interopRequireDefault(_Logger);

var _defaultConfig = require('./defaultConfig');

var _defaultConfig2 = _interopRequireDefault(_defaultConfig);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

function noop() {}

/*
  Eureka JS client
  This module handles registration with a Eureka server, as well as heartbeats
  for reporting instance health.
*/

function fileExists(file) {
  try {
    return _fs2.default.statSync(file);
  } catch (e) {
    return false;
  }
}

function getYaml(file) {
  var yml = {};
  if (!fileExists(file)) {
    return yml; // no configuration file
  }
  try {
    yml = _jsYaml2.default.safeLoad(_fs2.default.readFileSync(file, 'utf8'));
  } catch (e) {
    // configuration file exists but was malformed
    throw new Error('Error loading YAML configuration file: ' + file + ' ' + e);
  }
  return yml;
}

var Eureka = function (_EventEmitter) {
  _inherits(Eureka, _EventEmitter);

  function Eureka() {
    var config = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

    _classCallCheck(this, Eureka);

    // Allow passing in a custom logger:
    var _this = _possibleConstructorReturn(this, _EventEmitter.call(this));

    _this.logger = config.logger || new _Logger2.default();

    _this.logger.debug('initializing eureka client');

    // Load up the current working directory and the environment:
    var cwd = config.cwd || process.cwd();
    var env = process.env.NODE_ENV || 'development';

    var filename = config.filename || 'eureka-client';

    // Load in the configuration files:
    var defaultYml = getYaml(_path2.default.join(cwd, filename + '.yml'));
    var envYml = getYaml(_path2.default.join(cwd, filename + '-' + env + '.yml'));

    // apply config overrides in appropriate order
    _this.config = (0, _merge2.default)({}, _defaultConfig2.default, defaultYml, envYml, config);

    // Validate the provided the values we need:
    _this.validateConfig(_this.config);

    _this.requestMiddleware = _this.config.requestMiddleware;

    if (_this.amazonDataCenter) {
      _this.metadataClient = new _AwsMetadata2.default({
        logger: _this.logger
      });
    }

    if (_this.config.eureka.useDns) {
      _this.clusterResolver = new _DnsClusterResolver2.default(_this.config);
    } else {
      _this.clusterResolver = new _ConfigClusterResolver2.default(_this.config);
    }

    _this.cache = {
      app: {},
      vip: {}
    };
    return _this;
  }

  /*
    Helper method to get the instance ID. If the datacenter is AWS, this will be the
    instance-id in the metadata. Else, it's the hostName.
  */


  /*
    Registers instance with Eureka, begins heartbeats, and fetches registry.
  */
  Eureka.prototype.start = function start() {
    var _this2 = this;

    var callback = arguments.length <= 0 || arguments[0] === undefined ? noop : arguments[0];

    (0, _async.series)([function (done) {
      if (_this2.metadataClient && _this2.config.eureka.fetchMetadata) {
        return _this2.addInstanceMetadata(done);
      }
      done();
    }, function (done) {
      _this2.register(done);
    }, function (done) {
      _this2.startHeartbeats();
      if (_this2.config.eureka.fetchRegistry) {
        _this2.startRegistryFetches();
        if (_this2.config.eureka.waitForRegistry) {
          var _ret = function () {
            var waitForRegistryUpdate = function waitForRegistryUpdate(cb) {
              _this2.fetchRegistry(function () {
                var instances = _this2.getInstancesByVipAddress(_this2.config.instance.vipAddress);
                if (instances.length === 0) setTimeout(function () {
                  return waitForRegistryUpdate(cb);
                }, 2000);else cb();
              });
            };
            return {
              v: waitForRegistryUpdate(done)
            };
          }();

          if ((typeof _ret === 'undefined' ? 'undefined' : _typeof(_ret)) === "object") return _ret.v;
        }
        _this2.fetchRegistry(done);
      } else {
        done();
      }
    }], function (err) {
      for (var _len = arguments.length, rest = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        rest[_key - 1] = arguments[_key];
      }

      if (err) _this2.logger.warn('Error starting the Eureka Client', err);
      _this2.emit('started');
      callback.apply(undefined, [err].concat(rest));
    });
  };

  /*
    De-registers instance with Eureka, stops heartbeats / registry fetches.
  */


  Eureka.prototype.stop = function stop() {
    var callback = arguments.length <= 0 || arguments[0] === undefined ? noop : arguments[0];

    this.deregister(callback);
    clearInterval(this.heartbeat);
    clearInterval(this.registryFetch);
  };

  /*
    Validates client configuration.
  */


  Eureka.prototype.validateConfig = function validateConfig(config) {
    function validate(namespace, key) {
      if (!config[namespace][key]) {
        throw new TypeError('Missing "' + namespace + '.' + key + '" config value.');
      }
    }

    validate('instance', 'app');
    validate('instance', 'vipAddress');
    validate('instance', 'port');
    validate('instance', 'dataCenterInfo');

    if (typeof config.requestMiddleware !== 'function') {
      throw new TypeError('requestMiddleware must be a function');
    }
  };

  /*
    Registers with the Eureka server and initializes heartbeats on registration success.
  */


  Eureka.prototype.register = function register() {
    var _this3 = this;

    var callback = arguments.length <= 0 || arguments[0] === undefined ? noop : arguments[0];

    this.config.instance.status = 'UP';
    var connectionTimeout = setTimeout(function () {
      _this3.logger.warn('It looks like it\'s taking a while to register with ' + 'Eureka. This usually means there is an issue connecting to the host ' + 'specified. Start application with NODE_DEBUG=request for more logging.');
    }, 10000);
    this.eurekaRequest({
      method: 'POST',
      uri: this.config.instance.app,
      json: true,
      body: { instance: this.config.instance }
    }, function (error, response, body) {
      clearTimeout(connectionTimeout);
      if (!error && response.statusCode === 204) {
        _this3.logger.info('registered with eureka: ', _this3.config.instance.app + '/' + _this3.instanceId);
        _this3.emit('registered');
        return callback(null);
      } else if (error) {
        _this3.logger.warn('Error registering with eureka client.', error);
        return callback(error);
      }
      return callback(new Error('eureka registration FAILED: status: ' + response.statusCode + ' body: ' + body));
    });
  };

  /*
    De-registers with the Eureka server and stops heartbeats.
  */


  Eureka.prototype.deregister = function deregister() {
    var _this4 = this;

    var callback = arguments.length <= 0 || arguments[0] === undefined ? noop : arguments[0];

    this.eurekaRequest({
      method: 'DELETE',
      uri: this.config.instance.app + '/' + this.instanceId
    }, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        _this4.logger.info('de-registered with eureka: ' + _this4.config.instance.app + '/' + _this4.instanceId);
        _this4.emit('deregistered');
        return callback(null);
      } else if (error) {
        _this4.logger.warn('Error deregistering with eureka', error);
        return callback(error);
      }
      return callback(new Error('eureka deregistration FAILED: status: ' + response.statusCode + ' body: ' + body));
    });
  };

  /*
    Sets up heartbeats on interval for the life of the application.
    Heartbeat interval by setting configuration property: eureka.heartbeatInterval
  */


  Eureka.prototype.startHeartbeats = function startHeartbeats() {
    var _this5 = this;

    this.heartbeat = setInterval(function () {
      _this5.renew();
    }, this.config.eureka.heartbeatInterval);
  };

  Eureka.prototype.renew = function renew() {
    var _this6 = this;

    this.eurekaRequest({
      method: 'PUT',
      uri: this.config.instance.app + '/' + this.instanceId
    }, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        _this6.logger.debug('eureka heartbeat success');
        _this6.emit('heartbeat');
      } else if (!error && response.statusCode === 404) {
        _this6.logger.warn('eureka heartbeat FAILED, Re-registering app');
        _this6.register();
      } else {
        if (error) {
          _this6.logger.error('An error in the request occured.', error);
        }
        _this6.logger.warn('eureka heartbeat FAILED, will retry.' + ('statusCode: ' + (response ? response.statusCode : 'unknown')) + ('body: ' + body + ' ' + (error | '') + ' '));
      }
    });
  };

  /*
    Sets up registry fetches on interval for the life of the application.
    Registry fetch interval setting configuration property: eureka.registryFetchInterval
  */


  Eureka.prototype.startRegistryFetches = function startRegistryFetches() {
    var _this7 = this;

    this.registryFetch = setInterval(function () {
      _this7.fetchRegistry(function (err) {
        if (err) _this7.logger.warn('Error fetching registries', err);
      });
    }, this.config.eureka.registryFetchInterval);
  };

  /*
    Retrieves a list of instances from Eureka server given an appId
  */


  Eureka.prototype.getInstancesByAppId = function getInstancesByAppId(appId) {
    if (!appId) {
      throw new RangeError('Unable to query instances with no appId');
    }
    var instances = this.cache.app[appId.toUpperCase()] || [];
    if (instances.length === 0) {
      this.logger.warn('Unable to retrieve instances for appId: ' + appId);
    }
    return instances;
  };

  /*
    Retrieves a list of instances from Eureka server given a vipAddress
   */


  Eureka.prototype.getInstancesByVipAddress = function getInstancesByVipAddress(vipAddress) {
    if (!vipAddress) {
      throw new RangeError('Unable to query instances with no vipAddress');
    }
    var instances = this.cache.vip[vipAddress] || [];
    if (instances.length === 0) {
      this.logger.warn('Unable to retrieves instances for vipAddress: ' + vipAddress);
    }
    return instances;
  };

  /*
    Retrieves all applications registered with the Eureka server
   */


  Eureka.prototype.fetchRegistry = function fetchRegistry() {
    var _this8 = this;

    var callback = arguments.length <= 0 || arguments[0] === undefined ? noop : arguments[0];

    this.eurekaRequest({
      uri: '',
      headers: {
        Accept: 'application/json'
      }
    }, function (error, response, body) {
      if (!error && response.statusCode === 200) {
        _this8.logger.debug('retrieved registry successfully');
        try {
          _this8.transformRegistry(JSON.parse(body));
        } catch (ex) {
          return callback(ex);
        }
        _this8.emit('registryUpdated');
        return callback(null);
      } else if (error) {
        _this8.logger.warn('Error fetching registry', error);
        return callback(error);
      }
      callback(new Error('Unable to retrieve registry from Eureka server'));
    });
  };

  /*
    Transforms the given registry and caches the registry locally
   */


  Eureka.prototype.transformRegistry = function transformRegistry(registry) {
    var _this9 = this;

    if (!registry) {
      this.logger.warn('Unable to transform empty registry');
    } else {
      var _ret2 = function () {
        if (!registry.applications.application) {
          return {
            v: void 0
          };
        }
        var newCache = { app: {}, vip: {} };
        if (Array.isArray(registry.applications.application)) {
          registry.applications.application.forEach(function (app) {
            _this9.transformApp(app, newCache);
          });
        } else {
          _this9.transformApp(registry.applications.application, newCache);
        }
        _this9.cache = newCache;
      }();

      if ((typeof _ret2 === 'undefined' ? 'undefined' : _typeof(_ret2)) === "object") return _ret2.v;
    }
  };

  /*
    Transforms the given application and places in client cache. If an application
    has a single instance, the instance is placed into the cache as an array of one
   */


  Eureka.prototype.transformApp = function transformApp(app, cache) {
    var _this10 = this;

    if (app.instance.length) {
      var instances = app.instance.filter(function (instance) {
        return _this10.validateInstance(instance);
      });
      cache.app[app.name.toUpperCase()] = instances;
      cache.vip[app.instance[0].vipAddress] = instances;
    } else if (this.validateInstance(app.instance)) {
      var _instances = [app.instance];
      cache.vip[app.instance.vipAddress] = _instances;
      cache.app[app.name.toUpperCase()] = _instances;
    }
  };

  /*
    Returns true if instance filtering is disabled, or if the instance is UP
  */


  Eureka.prototype.validateInstance = function validateInstance(instance) {
    return !this.config.eureka.filterUpInstances || instance.status === 'UP';
  };

  /*
    Fetches the metadata using the built-in client and updates the instance
    configuration with the hostname and IP address. If the value of the config
    option 'eureka.useLocalMetadata' is true, then the local IP address and
    hostname is used. Otherwise, the public IP address and hostname is used.
     A string replacement is done on the healthCheckUrl and statusPageUrl so
    that users can define the URLs with a placeholder for the host ('__HOST__').
    This allows flexibility since the host isn't known until the metadata is
    fetched. The replaced value respects the config option 'eureka.useLocalMetadata'
    as described above.
     This will only get called when dataCenterInfo.name is Amazon, but you can
    set config.eureka.fetchMetadata to false if you want to provide your own
    metadata in AWS environments.
  */


  Eureka.prototype.addInstanceMetadata = function addInstanceMetadata() {
    var _this11 = this;

    var callback = arguments.length <= 0 || arguments[0] === undefined ? noop : arguments[0];

    this.metadataClient.fetchMetadata(function (metadataResult) {
      _this11.config.instance.dataCenterInfo.metadata = (0, _merge2.default)(_this11.config.instance.dataCenterInfo.metadata, metadataResult);
      var useLocal = _this11.config.eureka.useLocalMetadata;
      var metadataHostName = metadataResult[useLocal ? 'local-hostname' : 'public-hostname'];
      _this11.config.instance.hostName = metadataHostName;
      _this11.config.instance.ipAddr = metadataResult[useLocal ? 'local-ipv4' : 'public-ipv4'];

      if (_this11.config.instance.statusPageUrl) {
        var statusPageUrl = _this11.config.instance.statusPageUrl;

        var replacedUrl = statusPageUrl.replace('__HOST__', metadataHostName);
        _this11.config.instance.statusPageUrl = replacedUrl;
      }
      if (_this11.config.instance.healthCheckUrl) {
        var healthCheckUrl = _this11.config.instance.healthCheckUrl;

        var _replacedUrl = healthCheckUrl.replace('__HOST__', metadataHostName);
        _this11.config.instance.healthCheckUrl = _replacedUrl;
      }

      callback();
    });
  };

  /*
    Helper method for making a request to the Eureka server. Handles resolving
    the current cluster as well as some default options.
  */


  Eureka.prototype.eurekaRequest = function eurekaRequest(opts, callback) {
    var _this12 = this;

    var retryAttempt = arguments.length <= 2 || arguments[2] === undefined ? 0 : arguments[2];

    (0, _async.waterfall)([
    /*
    Resolve Eureka Clusters
    */
    function (done) {
      _this12.clusterResolver.resolveEurekaUrl(function (err, eurekaUrl) {
        if (err) return done(err);
        var requestOpts = (0, _merge2.default)({
          baseUrl: eurekaUrl,
          gzip: true
        }, opts);
        done(null, requestOpts);
      }, retryAttempt);
    },
    /*
    Apply Request Middleware
    */
    function (requestOpts, done) {
      _this12.requestMiddleware(requestOpts, function (newRequestOpts) {
        if ((typeof newRequestOpts === 'undefined' ? 'undefined' : _typeof(newRequestOpts)) !== 'object') {
          return done(new Error('requestMiddleware did not return an object'));
        }
        done(null, newRequestOpts);
      });
    },
    /*
    Perform Request
     */
    function (requestOpts, done) {
      var method = requestOpts.method ? requestOpts.method.toLowerCase() : 'get';
      _request2.default[method](requestOpts, function (error, response, body) {
        done(error, response, body, requestOpts);
      });
    }],
    /*
    Handle Final Output
     */
    function (error, response, body, requestOpts) {
      if (error) _this12.logger.error('Problem making eureka request', error);

      // Perform retry if request failed and we have attempts left
      var responseInvalid = response && response.statusCode && String(response.statusCode)[0] === '5';

      if ((error || responseInvalid) && retryAttempt < _this12.config.eureka.maxRetries) {
        var nextRetryDelay = _this12.config.eureka.requestRetryDelay * (retryAttempt + 1);
        _this12.logger.warn('Eureka request failed to endpoint ' + requestOpts.baseUrl + ', ' + ('next server retry in ' + nextRetryDelay + 'ms'));

        setTimeout(function () {
          return _this12.eurekaRequest(requestOpts, callback, retryAttempt + 1);
        }, nextRetryDelay);
        return;
      }

      callback(error, response, body);
    });
  };

  _createClass(Eureka, [{
    key: 'instanceId',
    get: function get() {
      if (this.config.instance.instanceId) {
        return this.config.instance.instanceId;
      } else if (this.amazonDataCenter) {
        return this.config.instance.dataCenterInfo.metadata['instance-id'];
      }
      return this.config.instance.hostName;
    }

    /*
      Helper method to determine if this is an AWS datacenter.
    */

  }, {
    key: 'amazonDataCenter',
    get: function get() {
      return this.config.instance.dataCenterInfo.name && this.config.instance.dataCenterInfo.name.toLowerCase() === 'amazon';
    }
  }]);

  return Eureka;
}(_events.EventEmitter);

exports.default = Eureka;