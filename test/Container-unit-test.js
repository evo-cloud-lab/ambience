var assert = require('assert'),
    Class  = require('js-class'),
    Try    = require('evo-elements').Try,

    Container = require('../lib/Container');

describe('Container', function () {
    var TestInterior = Class({
        constructor: function (params) {
            this._monitor = params.monitor;
        },

        load: function () { this.state = 'stopped'; },
        start: function () { this.state = 'running'; },
        stop: function () { this.state = 'stopped'; },
        unload: function () { this.state = 'offline'; },

        set state (s) {
            process.nextTick(function () {
                this._monitor('state', s);
            }.bind(this));
        }
    });

    var container;

    beforeEach(function () {
        container = new Container(0, function (id, params) {
            return new TestInterior(params);
        });
    });

    it('reaches the final state', function (done) {
        assert.equal(container.state, 'offline');
        var states = [];
        container.on('state', function (state) {
            states.push(state);
            if (state == 'running') {
                Try.final(function () {
                    assert.deepEqual(states, ['loading', 'stopped', 'starting', 'running']);
                }, done);
            }
        }).setState('running');
    });

    it('reports error if transition fails', function (done) {
        assert.equal(container.state, 'offline');
        container.interior.start = function () { this.state = 'stopped'; };
        var states = [];
        container.on('state', function (state) {
            states.push(state);
        }).on('error', function (err) {
            Try.final(function () {
                assert.equal(err.expectation, 'running');
                assert.equal(err.actual, 'stopped');
                assert.equal(container.state, 'stopped');
                assert.deepEqual(states, ['loading', 'stopped', 'starting', 'stopped']);
            }, done);
        }).setState('running');
    });
});
