import SockJS from 'sockjs-client';
import assign from 'object-assign';

import defineProperty from "./utils/define-property";
import getter from "./utils/getter";
import pick from "./utils/pick";
import intents from "./lib/intents";
import Channel from "./channel";
import EventEmitter from "events";

const events = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  TIMEOUT: 'timeout',
  RECONNECTED: 'reconnected',
  AUTHENTICATED: 'authenticated',
  AUTH_REJECTED: 'auth_rejected'
};

const defaultPersistence = {
  interval: 1000,
  attempts: 30,
  enabled: true
};

export default class PushrClient extends EventEmitter {

  static get events(){
    return events;
  }

  constructor(url, cfg = {}){
    super();

    this.channels = {}

    let _connecting = false,
        _persistence = pick(
          assign(
            {},
            defaultPersistence,
            cfg
          ),
          Object.keys(defaultPersistence)
        ),
        reconnect = this.reconnect.bind(this);

    getter(this, 'persistence', () => assign({}, _persistence));
    getter(this, 'connected', () => ((this.sock || {}).readyState === 1));
    getter(this, 'connecting', () => _connecting);

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

    this.connect = function connect(){
  		_connecting = true;
      this.emit(events.CONNECTING);

      let sock = this.sock = new SockJS(url);

  		// create connection Promise
  		this.didConnect = new Promise( (resolve) => {
  			if(sock.readyState > 0){
  				resolve();
  			} else {
  				sock.addEventListener("open", resolve);
  			}
  		});

  		this.didConnect
  			.then(() => {
          this.sock.addEventListener("message", m => this.dispatch(m));

          _connecting = false;

          this.emit(events.CONNECTED);
          this.$send(intents.AUTH_REQ, null, {auth: this.credentials});
  				sock.addEventListener("close", () => {
            Object.keys(this.channels).forEach(topic => {
              this.channels[topic].channelDidClose();
            });
            this.emit(events.DISCONNECTED);
          });
  				if(_persistence.enabled){
  					// reset up a persistent connection, aka attempt to reconnect if the connection closes
  					sock.addEventListener("close", reconnect);
  				}
  			});
  	};
  }

  close(){
    this.disablePersistence();
    this.sock && this.sock.close();
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
      this.$send(intents.UNS_REQ, topic);
  }

  dispatch(message = {}){
    try {
      message = JSON.parse(message.data);
    }catch(e){
      return;
    }

    let {intent, topic, payload} = message;
    let channel = this.channels[topic];

    switch(intent){
      case intents.AUTH_ACK:
        this.emit(events.AUTHENTICATED, payload);
        break;
      case intents.AUTH_REJ:
        this.emit(events.AUTH_REJECTED, payload);
        break;
      case intents.SUB_ACK:
        if(channel)
          channel.channelDidOpen(payload);
        else
          this.$send(intent.UNS_REQ, topic);
        break;
      case intents.SUB_REJ:
        if(channel)
          channel.channelDidReject(payload);
        break;
      case intents.UNS_ACK:
        if(channel)
          channel.channelDidClose();
        break;
      case intents.PUSH:
        if(channel){
          let {event, data} = payload;
          payload.event && channel.emit(event, data);
          // allow generic handler for all messages regardless of event
          channel.onmessage && channel.onmessage(data, event);
        }
        break;
      default:
        break;
    }
  }

  reconnect(){
    if(!this.connecting){
			let attemptsMade = 0;
		  let attemptsRemaining = this.persistence.attempts;
			let currentAttempt;

			let attemptReconnection = () => {
				if(!attemptsRemaining){
					// Failure, stop trying to reconnect
          clearTimeout(currentAttempt);
					this.emit(events.TIMEOUT);
				} else {
					let delay, {interval} = this.persistence;

					// setup to try again after interval
					if(typeof interval === 'number'){
						delay = interval;
					} else if(typeof interval === 'function'){
						delay = interval(attemptsMade);
					}

					currentAttempt = setTimeout(() => attemptReconnection(), delay);
					attemptsMade++;
					attemptsRemaining--;


					// attempt to re-establish the websocket connection
					// resets `this.sock`
					// resets `this.didConnect` to a new Promise resolved by `this.sock`
					this.connect();

					this.didConnect.then(() => {
            // Success, stop trying to reconnect,
						attemptsRemaining = 0;
						clearTimeout(currentAttempt);

            // re-open all channels
            Object.keys(this.channels).forEach(topic => {
              this.channels[topic].open();
            });

  					// re-apply the message handling multiplexer to the new sockjs instance
  					this.sock.addEventListener("message", m => this.dispatch(m));

						this.emit(events.RECONNECTED);
					});
				}
			};

      // near immediately try to reconnect
      currentAttempt = setTimeout(() => attemptReconnection(), 200);
    }
  }

  $send(intent, topic, payload = {}){
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

  didAuthenticate(){
    return;
  }

  handleAuthRejection(){
    return;
  }
}
