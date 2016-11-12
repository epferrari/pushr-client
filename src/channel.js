"use strict";

import assign from "object-assign";
import defineProperty from "./utils/define-property";
import getter from "./utils/getter";
import intents from "./lib/intents";
import EventEmitter from 'events';

export default class Channel extends EventEmitter {
  static get events(){
    return {
      channelWillOpen: 'channel-will-open',
      channelDidOpen: 'channel-did-open',
      channelWillClose: 'channel-will-close',
      channelDidClose: 'channel-did-close',
      channelRejected: 'channel-rejected',
      messageReceived: 'message-received'
    };
  }

  constructor(client = {}, topic = "", cfg = {}){
    super();
    let subscribed = false;

    this.client = client;
    this.topic = topic;
    this._lifecycle = new EventEmitter();

    getter(this, 'subscribed', () => subscribed);

    defineProperty(this, 'handleIntent', (intent, message = {}) => {
      let {payload, error} = message;

      switch(intent){
        case intents.SUB_ACK:
          subscribed = true;
          this._lifecycle.emit(Channel.events.channelDidOpen, payload);
          break;
        case intents.SUB_REJ:
          this._lifecycle.emit(Channel.events.channelRejected, error);
          break;
        case intents.UNS_ACK:
          subscribed = false;
          this._lifecycle.emit(Channel.events.channelDidClose, payload);
          break;
        case intents.MSG:
          let {event, _self} = message;
          // allow generic handler for all messages regardless of event
          this._lifecycle.emit(Channel.events.messageReceived, payload, event, _self);
          // call specific handlers for events
          event && this.emit(event, payload, _self);
          break;
        default:
          return;
      }
    });

    ['onWillOpen', 'onDidOpen', 'onWillClose', 'onDidClose', 'onReject']
    .forEach(
      handler => cfg[handler] && this[handler](cfg[handler])
    );
  }

  open(){
    if(!this.subscribed){
      this._lifecycle.emit(Channel.events.channelWillOpen);
      this.client.send(intents.SUB_REQ, this.topic, {auth: this.client.auth});
    }
  }

  close(){
    this._lifecycle.emit(Channel.events.channelWillClose, payload);
    this.client.send(intents.UNS_REQ, this.topic);
  }

  onWillOpen(fn){
    let evt = Channel.events.channelWillOpen;
    this._lifecycle.on(evt, fn);
    return this._lifecycle.removeListener.bind(this, evt, fn);
  }

  onDidOpen(fn){
    let evt = Channel.events.channelDidOpen;
    this._lifecycle.on(evt, fn);
    return this._lifecycle.removeListener.bind(this, evt, fn);
  }

  onWillClose(fn){
    let evt = Channel.events.channelWillClose;
    this._lifecycle.on(evt, fn);
    return this._lifecycle.removeListener.bind(this, evt, fn);
  }

  onDidClose(fn){
    let evt = Channel.events.channelDidClose;
    this._lifecycle.on(evt, fn);
    return this._lifecycle.removeListener.bind(this, evt, fn);
  }

  onReject(fn){
    let evt = Channel.events.channelRejected;
    this._lifecycle.on(evt, fn);
    return this._lifecycle.removeListener.bind(this, evt, fn);
  }

  onMessage(fn){
    let evt = Channel.events.massageReceived;
    this._lifecycle.on(evt, fn);
    return this._lifecycle.removeListener.bind(this, evt, fn);
  }
}
