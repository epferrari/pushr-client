import SockJS from 'sockjs-client';
import assign from 'object-assign';





const defaultPersistence = {
  onConnecting(){},
  onConnected(){},
  onDisconnected(){},
  onReconnected(){},
  interval: 300,
  attempts: 10
};

const intent = {
  AUTH_REQ: 1,    // authentication request (inbound)
  AUTH_ACK: 2,    // authentication acknowledgement, credentials saved (outbound)
  AUTH_REJ: 3,    // authentication rejected, credentials were invalid (outbound)
  AUTH_ERR: 4,    // authentication error, client has already saved credentials (outbound)

  SUB_REQ: 5,     // subscription request (inbound)
  SUB_ACK: 6,     // subscription acknowledgement, authorized and subscribed (outbound)
  SUB_REJ: 7,     // subscription rejection, unauthorized (outbound)
  SUB_ERR: 8,     // subscription error (outbound)

  UNS_REQ: 9,     // unsubscribe request (inbound)
  UNS_ACK: 10,    // unsubscribe acknowledgement (outbound)
  UNS_REJ: 11,    // unsubscribe rejection (outbound)
  UNS_ERR: 12,    // unsubscribe error (outbound)

  CLOSE_REQ: 13,  // connection close request (inbound)
  CLOSE_ACK: 14,  // connection close acknowledgement (outbound)
  CLOSE_ERR: 15,  // connection close error (outbound)

  TYPE_ERR: 16,   // invalid message type (outbound)
  BAD_REQ: 17,    // invalid message shape (outbound)
  PUSH: 18        // message pushed to client (outbound)
}

class Channel {
  constructor(client = {}, topic = "", cfg = {}){
    this.client = client;
    this.topic = topic;
    subscribed = false;

    defineProperty(this, 'onSubscribe', function onSubscribe(payload){
      subscribed = true;
      cfg.onSubscribe && cfg.onSubscribe(payload);
    });

    defineProperty(this, 'onClose', function onClose(payload){
      subscribed = false;
      cfg.onClose && cfg.onClose(payload);
    });

    getter(this, 'subscribed', () => subscribed);
  }

  open(auth = {}){
    if(!this.subscribed){
      this.onWillSubscribe && this.onWillSubscribe();
      send(this.client, intent.SUB_REQ, {topic: this.topic}, auth);
    }
  }

  close(){
    this.onWillClose && this.onWillClose();
    send(this.client, intent.UNS_REQ, {topic: this.topic});
  }

  onWillSubscribe(){}
  onSubRejected(){}
  onWillClose(){}
  onMessage(payload){}
}


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

    this.url = url;
    this.connect();

    this.connect = function connect(){
      _persistence.onConnecting();
  		_connecting = true;

      let sock = this.sock = new SockJS(this.url);
      sock.addEventListener("message", m => this.dispatch(m));

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
  					sock.addEventListener("close", this.reconnect.bind(this));
  				}
  			});
  	}

  }


  reconnect(){}

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
          channel.onMessage(payload);
        break;
      default:
        break;
    }
}

function pick(obj, props){
	return Object.keys(obj).reduce((acc, key) => {
		if(props.includes(key)){
			acc[key] = obj[key];
		}
		return acc;
	}, {});
}

function getter(obj, propName, fn){
  Object.defineProperty(obj, propName, {
    get: () => fn(),
    enumerable: false,
    configurable: false,
    writable: false
  });
}

function defineProperty(obj, propName, value){
  Object.defineProperty(obj, propName, {
    value,
    enumerable: false,
    writable: false,
    configurable: false
  });
}

function send(client, intent, payload, auth){
  client.didConnect.then(() =>
    client.sock.send(JSON.stringify({
      intent,
      payload: assign({}, payload, {auth: client.credentials}, {auth})
    }));
  );
}
