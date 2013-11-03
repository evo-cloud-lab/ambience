var Class    = require('js-class'),
    elements = require('evo-elements'),
        Logger = elements.Logger,
        Errors = elements.Errors,
        Try    = elements.Try,
    neuron   = require('evo-neuron'),
        ProgramBase = neuron.Program,
        Message     = neuron.Message,

    Container = require('./Container');

var CREATE_SCHEMA = {
    id: 'string',
    conf: 'object'
};

var ID_SCHEMA = {
    id: 'string'
};

var STOP_SCHEMA = {
    id: 'string',
    force: { nullable: 'boolean' }
};

var Program = Class(ProgramBase, {
    constructor: function () {
        ProgramBase.prototype.constructor.call(this, 'ambience');

        this._containers = {};

        this
            .dispatch('container.create', { schema: CREATE_SCHEMA })    // create and load container
            .dispatch('container.start',  { schema: ID_SCHEMA })        // start container
            .dispatch('container.stop',   { schema: STOP_SCHEMA })      // stop container
            .dispatch('container.destroy', { schema: ID_SCHEMA })       // unload and delete container
            .dispatch('container.query',  { schema: ID_SCHEMA })        // query the specified container
            .dispatch('container.list')                                 // list all container ids
        ;
    },

    'neuron:container.create': function (req, params) {
        var container = this._containers[params.id];
        if (container) {
            req.respond(Errors.conflict(params.id));
        } else {
            Try.final(function () {
                this._addContainer(new Container(params.id, params.conf, new Logger('ambience:' + params.id)));
            }.bind(this), req.done);
        }
    },

    'neuron:container.start': function (req, params) {
        this._withContainer(req, params, function (container) {
            container.start();
        });
    },

    'neuron:container.stop': function (req, params) {
        var opts = { force: params.force };
        this._withContainer(req, params, function (container) {
            container.stop(opts);
        });
    },

    'neuron:container.destroy': function (req, params) {
        this._withContainer(req, params, function (container) {
            container.unload();
        });
    },

    'neuron:container.query': function (req, params) {
        var info;
        this._withContainer(req, params, function (container) {
            info = container.toObject();
        }, function (err) {
            req.done(err, info);
        });
    },

    'neuron:container.list': function (req) {
        req.ok({ ids: Object.keys(this._containers) });
    },

    _withContainer: function (req, params, logic, done) {
        var container = this._containers[params.id];
        container ? Try.final(function () {
                logic.call(this, container, req, params);
            }.bind(this), done || req.done)
                  : req.fail(Errors.nonexist(params.id));
    },

    _addContainer: function (container) {
        (this._containers[container.id] = container)
            .on('state', this.onContainerState.bind(this))
            .on('status', this.onContainerStatus.bind(this))
            .on('error', this.onContainerError.bind(this))
            .load();
    },

    onError: function () {
        // ignore neuron communication errors because there's
        // no up-going communications
    },

    onContainerState: function (state, lastState, container) {
        this.neuron.cast({
            event: 'container.state',
            data: {
                id: container.id,
                state: state,
                lastState: lastState
            }
        });
        if (state == 'offline' && lastState != 'offline') {
            delete this._containers[container.id];
        }
    },

    onContainerStatus: function (status, container) {
        this.neuron.cast({
            event: 'container.status',
            data: {
                id: container.id,
                status: status
            }
        });
    },

    onContainerError: function (err, container) {
        var errMsg = Message.error(err);
        errMsg.data.id = container.id;
        this.neuron.cast({
            event: 'container.error',
            data: errMsg.data
        });
    }
});

module.exports = Program;
