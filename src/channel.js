"use strict";

import assign from "object-assign";
import defineProperty from "./utils/define-property";
import getter from "./utils/getter";
import intents from "./lib/intents";
import EventEmitter from 'events';

export default class Channel extends EventEmitter {
  constructor(client = {}, topic = "", cfg = {}){
    super();

    this.client = client;
    this.topic = topic;

    let subscribed = false;

    getter(this, 'subscribed', () => subscribed);

    defineProperty(this, 'channelDidOpen', function channelDidOpen(payload){
      subscribed = true;
      cfg.channelDidOpen && cfg.channelDidOpen(payload);
    });

    defineProperty(this, 'channelDidClose', function channelDidClose(payload){
      subscribed = false;
      cfg.channelDidClose && cfg.channelDidClose(payload);
    });

    [
      'channelWillOpen',
      'channelDidReject',
      'channelWillClose'
    ]
    .forEach(handler => cfg[handler] && (this[handler] = cfg[handler]));
  }

  open(){
    if(!this.subscribed){
      this.channelWillOpen && this.channelWillOpen();
      this.client.send(intents.SUB_REQ, this.topic, {auth: client.auth});
    }
  }

  close(){
    this.channelWillClose && this.channelWillClose();
    this.client.send(intents.UNS_REQ, this.topic);
  }

  channelWillOpen(){}
  channelDidReject(){}
  channelWillClose(){}
}
