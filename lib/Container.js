/** @fileoverview
 * Container is the facet of an isolated environment
 * inside which an operating system is running.
 * The inner isolated environment can be supported by
 * a certain containment implementation, like LXC,
 * KVM etc.
 *
 * A container is always associated with a state:
 * {
 *      name: string [mandatory] - current state of interior
 *      info: object [optional] - must be present when in 'fault' state
 * }
 *      The value of 'name' should be one of
 *          'offline'   The container is not loaded
 *          'loading'   The container is being loaded
 *          'unloading' The container is being unloaded
 *          'stopped'   The interior is ready, but not started
 *          'starting'  The interior has been requested to start, and is in progress
 *          'running'   The interior is started, and is running
 *          'stopping'  The interior has been requested to stop, and is in progress
 *
 * Interior Abstraction
 *
 * An interior registered here is a factory function
 * which conforms to:
 *      function interiorFactory (id, config, params);
 * parameters:
 *      id          Unique identifier
 *      config      The configuration object
 *      params      Extra parameters, includes
 *          - monitor   The monitoring function to receive all events
 *          - logger    The logging facilitate
 * return:
 *      the interior instance
 *
 * The 'monitor' can be used to report status or errors, it is defined as
 *      function monitor(event, object);
 *      'event' is defined as:
 *          'state': interior state name, should be one of 'offline', 'stopped', 'running'
 *          'status': status update, object is interior specific or TO BE DEFINED
 *          'error': error happens, object is an Error instance
 *
 * An interior instance must providing the following methods:
 *
 * load: function (opts); [Optional]
 *      Request to load the interior.
 *      This method can only be used when 'state.name' is 'offline'.
 *
 * unload: function (opts); [Optional]
 *      Request to unload (offline) the interior.
 *      This method can only be used when 'state.name' is 'stopped'
 *      If not implemented, the container automatically goes to 'offline' state.
 *
 * start: function (opts);
 *      Request to start the interior.
 *      This method can only be used when 'state.name' is 'stopped'.
 *
 * stop: function (opts);
 *      Request to stop the interior.
 *      This method can only be used when 'state.name' is one of:
 *          'starting', 'running', 'stopping'.
 *
 *      'opts' can contain following properties:
 *          force: boolean  When true, kill the interior immediately.
 *
 * status: function (opts); [Optional]
 *      Request detailed status from the interior asynchronously.
 *      The reported status object should be passed through 'monitorFn' and
 *      schema is interior specific or TO BE DEFINED.
 */

var Class    = require('js-class'),
    elements = require('evo-elements'),
    Config = elements.Config,
    Logger = elements.Logger,
    States = elements.States;

var STABLE_STATES = ['offline', 'stopped', 'running'];

var TransitRules = Class(States, {
    constructor: function (container, initialState) {
        States.prototype.constructor.call(this, initialState);
        this.container = container;
    },

    'offline:stopped': function () {
        this._invoke('loading', 'load', 'stopped');
        return ['loading', 'stopped'];
    },

    'offline:running': function () {
        this._invoke('loading', 'load', 'stopped');
        return ['loading', 'stopped'];
    },

    'loading:offline': function () {
        this._invoke('unloading', 'unload', 'offline');
        return ['unloading', 'stopped', 'offline'];
    },

    'loading:stopped': function () {
        return ['stopped'];
    },

    'loading:running': function () {
        return ['stopped'];
    },

    'stopped:offline': function () {
        this._invoke('unloading', 'unload', 'offline');
        return ['unloading', 'offline'];
    },

    'stopped:running': function () {
        this._invoke('starting', 'start');
        return ['starting', 'running'];
    },

    'starting:offline': function () {
        this._invoke('stopping', 'stop');
        return ['running', 'stopping', 'stopped'];
    },

    'starting:stopped': function () {
        this._invoke('stopping', 'stop');
        return ['running', 'stopping', 'stopped'];
    },

    'starting:running': function () {
        return ['running'];
    },

    'running:stopped': function () {
        this._invoke('stopping', 'stop');
        return ['stopping', 'stopped'];
    },

    'running:offline': function () {
        this._invoke('stopping', 'stop');
        return ['stopping', 'stopped'];
    },

    'stopping:offline': function () {
        return ['stopped'];
    },

    'stopping:stopped': function () {
        return ['stopped'];
    },

    'stopping:running': function () {
        return ['stopped'];
    },

    'unloading:offline': function () {
        return ['offline'];
    },

    'unloading:stopped': function () {
        return ['offline'];
    },

    'unloading:running': function () {
        return ['offline'];
    },

    _invoke: function (intermediateState, action, autoTransitState) {
        process.nextTick(function () {
            this.current = intermediateState;
            var fn = this.container.interior[action];
            if (typeof(fn) == 'function') {
                process.nextTick(function () { fn.call(this, {}); }.bind(this.container.interior));
            } else if (autoTransitState) {
                process.nextTick(function () { this.current = autoTransitState; }.bind(this));
            }
        }.bind(this));
    }
});

var Container = Class(process.EventEmitter, {

    /** @constructor
     * @description Instantiate a new container instance
     *
     * @param {String} id   Identifier of this container
     * @param {String|object} conf  Container configuration
     *              - if it is a String, it is the path and
     *                name of configuration file
     *              - if it is an object, it is the configuration
     * @param logger    Logging facilitate
     */
    constructor: function (id, conf, logger) {
        this._id = id;
        this.logger = Logger.wrap(logger);

        var factory;
        if (typeof(conf) == 'function') {
            factory = conf;
        } else {
            typeof(conf) == 'string' && (conf = Config.loadFileSync(conf));
            if (typeof(conf) != 'object') {
                throw new Error('Invalid configuration');
            }

            var interiorFactory = Container.interiors[conf.interior || Container.defaultInterior];
            if (!interiorFactory) {
                throw new Error('Invalid interior ' + conf.interior);
            }

            factory = function (id, params) {
                return interiorFactory(id, conf, params);
            };
        }

        this._interior = factory(id, {
            logger: this.logger,
            monitor: this._monitorEvent.bind(this)
        });
        this._interiorState = 'offline';
        (this._transits = new TransitRules(this, 'offline'))
            .on('done', this._stateReady.bind(this))
            .on('state', this._stateTransit.bind(this))
            .on('error', this._transitionError.bind(this));
    },

    /** @field
     * @description Container identifier
     * This is read-only
     */
    get id () {
        return this._id;
    },

    /** @field
     * @description Interior
     */
    get interior () {
        return this._interior;
    },

    /** @field
     * @description Current state
     */
    get state () {
        return this._transits.current;
    },

    /** @field
     * @description Interior state
     */
    get interiorState () {
        return this._interiorState;
    },

    /** @field
     * @description Recent status
     */
    get recentStatus() {
        return this._status;
    },

    /** @function
     * @description Set expected state
     */
    setState: function (expectedState) {
        if (STABLE_STATES.indexOf(expectedState) < 0) {
            throw new Error('Invalid Argument: ' + expectedState);
        }
        return this._transits.setExpectation(expectedState);
    },

    /** @function
     * @description Request status query
     */
    status: function () {
        var fn = this._interior.status;
        typeof(fn) == 'function' && fn.call(this._interior);
        return this;
    },

    toObject: function () {
        return {
            id: this.id,
            state: this.state,
            interiorState: this.interiorState,
            recentStatus: this.recentStatus
        };
    },

    // Internals

    _monitorEvent: function (event, data) {
        this.logger.verbose('MONITOR %s: %j', event, data);
        switch (event) {
            case 'error':
                this._interiorError(data);
                break;
            case 'state':
                if (typeof(data) == 'string' && STABLE_STATES.indexOf(data) >= 0) {
                    this._interiorState = data;
                    this._transits.current = data;
                }
                break;
            case 'status':
                this._status = data;
                this.emit('status', data, this);
                break;
        }
    },

    _interiorError: function (err) {
        this.logger.error('INTERIOR ERROR: %s', err.message);
        this.emit('error', err, this);
    },

    _transitionError: function (err) {
        this.logger.error('TRANSITION ERROR: %s !%s %j', err.expectation, err.actual, err.accepts);
        this.emit('error', err, this);
    },

    _stateTransit: function (curr, prev) {
        this.logger.debug('TRANSIT %s -> %s', prev, curr);
        this.emit('state', curr, prev, this);
    },

    _stateReady: function (state) {
        this.logger.verbose('READY %s', state);
        this.emit('ready', state, this);
    }
}, {
    statics: {
        /** @static
         * @description All supported interiors are registered here
         */
        interiors: {
            external: require('./interiors/external')
        },

        defaultInterior: 'external'
    }
});

module.exports = Container;
