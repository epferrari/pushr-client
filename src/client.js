import SockJS from 'sockjs-client';
import assign from 'object-assign';

import EventEmitter from "events";
import Channel from "./channel";

import defineProperty from "./utils/define-property";
import getter from "./utils/getter";
import pick from "./utils/pick";

import intents from "./lib/intents";
import events from "./lib/events";
import states from "./lib/states";

const defaultPersistence = {
  interval: 1000,
  attempts: 30,
  enabled: true
};

export default class PushrClient extends EventEmitter {

  static get events(){
    return events;
  }

  static get states(){
    return states;
  }

  constructor(url, cfg = {}){
    super();

    this.channels = {}

    let
    _state = states.READY,
    _connecting = false,
    _persistence = pick(
      assign(
        {},
        defaultPersistence,
        cfg
      ),
      Object.keys(defaultPersistence)
    ),
    reconnect = this.reconnect.bind(this),
    dispatch = this.dispatch.bind(this),
    checkStateChange = lastState => {
      if(lastState !== _state)
        this.emit(events.STATE_CHANGE, _state, lastState);
    };

    getter(this, 'state', () => _state);
    getter(this, 'persistence', () => assign({}, _persistence));
    getter(this, 'connected', () => ((this.sock || {}).readyState === 1));
    getter(this, 'auth', () => cfg.auth);

    this.disablePersistence = () => {
      if(_persistence.enabled && this.sock)
        this.sock.removeEventListener("close", reconnect);
      _persistence.enabled = false;
    };

    this.enablePersistence = () => {
      if(!_persistence.enabled && this.sock)
        this.sock.addEventListener("close", reconnect);
      _persistence.enabled = true;
    };

    this
    .on(events.CONNECTING, () => {
      let lastState = _state;
      _state = states.CONNECTING;
      checkStateChange(lastState);
    })
    .on(events.CONNECTED, () => {
      let lastState = _state;
      _state = this.connected ? states.CONNECTED : lastState;
      checkStateChange(lastState);
    })
    .on(events.DISCONNECTED, () => {
      let lastState = _state;
      _state = states.DISCONNECTED;
      checkStateChange(lastState);
    })
    .on(events.TIMEOUT, () => {
      let lastState = _state;
      _state = states.TIMED_OUT;
      checkStateChange(lastState);
    });


    this.connect = function connect(){
      if(cfg.enabled !== false)
        this.enablePersistence();

      this.emit(events.CONNECTING);

      this.sock = new SockJS(url);

  		// create connection Promise
  		return this.didConnect = new Promise( (resolve) => {
  			if(this.sock.readyState > 0){
  				resolve();
  			} else {
  				this.sock.addEventListener("open", resolve);
  			}
  		})
      .then(() => {
        this.sock.addEventListener("message", dispatch);

        this.emit(events.CONNECTED);
        this.send(intents.AUTH_REQ, null, {auth: this.auth});

        this.sock.addEventListener("close", () => {
          this.sock = null;
          this.closeAllChannels();
          this.emit(events.DISCONNECTED);
        });

        // reset up a persistent connection, aka attempt to reconnect if the connection closes
        if(_persistence.enabled)
          this.sock.addEventListener("close", reconnect);
			});
  	};
  }

  channel(topic, cfg){
    let channel;
    if(!(channel = this.channels[topic]))
      channel = this.channels[topic] = new Channel(this, topic, cfg);
    return channel;
  }

  subscribe(topic, cfg, auth){
    let channel;
    if(!(channel = this.channels[topic]))
      channel = this.channels[topic] = new Channel(this, topic, cfg);

    if(!channel.subscribed)
      channel.open(auth);

    return channel;
  }

  unsubscribe(topic){
    let channel = this.channels[topic];
    if(channel)
      channel.close();
    else
      this.send(intents.UNS_REQ, topic);
  }

  dispatch(transportMessageEvent = {}){
    let message;
    try {
      message = JSON.parse(message.data);
    }catch(e){
      return;
    }

    let {intent, topic, payload, error} = message;
    let channel = this.channels[topic];

    switch(intent){
      case intents.CONN_ACK:
        this.client_id = payload.client_id;
        break;
      case intents.AUTH_ACK:
        this.emit(events.AUTHENTICATED, payload);
        break;
      case intents.AUTH_REJ:
        this.emit(events.AUTH_REJECTED, error);
        break;
      default:
        channel && channel.handleIntent(intent, message);
    }
  }

  close(){
    this.disablePersistence();
    let close = () => this.sock.close();
    if(this.sock){
      close();
    }else{
      this.didConnect.then(close);
    }
  }

  closeAllChannels(){
    Object.keys(this.channels).forEach(topic => {
      let channel = this.channels[topic];
      if(this.sock){
        // unsubscribe each via the websocket
        channel.close();
      }else {
        // connection is gone, force close all
        channel.handleIntent(intents.UNS_ACK);
      }
    });
  }

  openAllChannels(){
    Object.keys(this.channels).forEach(topic => {
      this.channels[topic].open();
    });
  }

  onStateChange(handler){
    this.on(events.STATE_CHANGE, handler);
    return () => this.removeListener(events.STATE_CHANGE, handler);
  }

  reconnect(){
    if(this.state !== states.CONNECTING){
			let remaining = this.persistence.attempts, currentAttempt;

			let attemptReconnection = () => {
				if(!remaining){
					// Failure, stop trying to reconnect
          clearTimeout(currentAttempt);
					this.emit(events.TIMEOUT);
				} else {
					let delay, {interval} = this.persistence;

					if(typeof interval === 'number'){
						delay = interval;
					} else if(typeof interval === 'function'){
						delay = interval(this.persistence.attempts - remaining);
					}

          remaining--;
					currentAttempt = setTimeout(() => attemptReconnection(), delay);

					this.connect().then(() => {
            // Success, stop trying to reconnect,
						remaining = 0;
						clearTimeout(currentAttempt);
            this.openAllChannels();
						this.emit(events.RECONNECTED);
					});
				}
			};

      // start trying to reconnect as soon as the connection is lost
      currentAttempt = setTimeout(() => attemptReconnection(), 200);
    }
  }

  send(intent, topic, payload = {}){
    let send = () =>
      this.sock.send(JSON.stringify({
        intent,
        topic,
        payload: assign({}, {auth: this.credentials}, payload)
      }));

    if(this.connected){
      send();
    }else if(this.sock){
      this.didConnect.then(send);
    }else{
      this.once(events.CONNECTED, send);
    }
  };

  didAuthenticate(){}

  handleAuthRejection(){}
}
