import SockJS from 'sockjs-client';
import assign from 'object-assign';

import defineProperty from "./utils/define-property";
import getter from "./utils/getter";
import send from "./lib/send";
import intent from "./lib/intent-codes";

const defaultPersistence = {
  onConnecting(){},
  onConnected(){},
  onDisconnected(){},
  onReconnected(){},
  onTimeout(){},
  interval: 300,
  attempts: 10
};

export default class PushrClient {
  constructor(url, config = {}){

    let _connecting = false,
        _persistence = pick(
          assign(
            {},
            defaultPersistence,
            (config.persistence || {})
          ),
          Object.keys(defaultPersistence)
        );

    getter(this, 'persistence', () => assign({}, _persistence);
    getter(this, 'connected', () => ((this.sock || {}).readyState === 1));
    getter(this, 'connecting', () => _connecting);

    this.connect = function connect(){
      _persistence.onConnecting();
  		_connecting = true;

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
  				_connecting = false;
  				_persistence.onConnected();
          send(this, intent.AUTH_REQ, null, this.credentials);
  				sock.addEventListener("close", () => _persistence.onDisconnect());
  				if(_persistence.enabled){
  					// reset up a persistent connection, aka attempt to reconnect if the connection closes
  					sock.addEventListener("close", () => this.reconnect());
  				}
  			});
  	};

    this.connect();
    sock.addEventListener("message", m => this.dispatch(m));
  }

  channel(topic, cfg){
    let channel;
    if(!channel = this.channels[topic])
      channel = this.channels[topic] = new Channel(this, topic, cfg);
    return channel;
  }

  subscribe(topic, cfg, auth){
    let channel;
    if(!channel = this.channels[topic])
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
      send(this, intent.UNS_REQ, {topic});
  }

  dispatch(message = {}){
    try {
      message = JSON.parse(message.data);
    }catch(e){
      return;
    }

    let {topic, intent, payload} = message;
    let channel = this.channels[topic];


    switch(intent){
      case intent.AUTH_ACK:
        this.onAuthenticated && this.onAuthenticated(payload);
        break;
      case intent.AUTH_REJ:
        this.onAuthRejected && this.onAuthRejected(payload);
        break;
      case intent.SUB_ACK:
        if(channel)
          channel.onSubscribe(payload);
        else
          send(this, intent.UNS_REQ, topic);
        break;
      case intent.SUB_REJ:
        if(channel)
          channel.onSubRejected(payload);
        break;
      case intent.UNS_ACK:
        if(channel)
          channel.onClose();
        break;
      case intent.POST:
        if(channel)
          channel.notify(payload);
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
					this.persistence.onTimeout();
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

					// re-open all channels
          Object.keys(this.channels).forEach(topic => {
            this.channels[topic].open();
          });

					// re-apply the message handling multiplexer
					this.sock.addEventListener("message", m => this.dispatch(m));

					// Success, stop trying to reconnect,
					this.didConnect.then(() => {
						attemptsRemaining = 0;
						clearTimeout(currentAttempt);
						this.persistence.onReconnect();
					});
				}
			};

      // near immediately try to reconnect
      currentAttempt = setTimeout(() => attemptReconnection(), 200);
  }
}
