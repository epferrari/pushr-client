"use strict";

import defineProperty from "./utils/define-property";
import getter from "./utils/getter";
import send from "./lib/send";
import intent from "./lib/intent-codes";

export default class Channel {
  constructor(client = {}, topic = "", cfg = {}){
    this.client = client;
    this.topic = topic;
    listeners = [];
    subscribed = false;

    getter(this, 'subscribed', () => subscribed);

    defineProperty(this, 'onSubscribe', function onSubscribe(payload){
      subscribed = true;
      cfg.onSubscribe && cfg.onSubscribe(payload);
    });

    defineProperty(this, 'onClose', function onClose(payload){
      subscribed = false;
      cfg.onClose && cfg.onClose(payload);
    });

    defineProperty(this, 'onMessage', function onMessage(handler){
      listeners.push(handler);
      return () => {
        listeners = listeners.filter(fn => fn != handler);
      }
    });

    defineProperty(this, 'notify', function notify(payload){
      listeners.forEach(fn => fn(payload));
    });

    [
      'onWillSubscribe',
      'onSubRejected',
      'onWillClose'
    ]
    .forEach(handler => cfg[handler] && (this[handler] = cfg[handler]));
  }

  open(auth){
    if(auth)
      this.auth = auth;

    if(!this.subscribed){
      this.onWillSubscribe && this.onWillSubscribe();
      send(this.client, intent.SUB_REQ, {topic: this.topic}, this.auth);
    }
  }

  close(){
    this.onWillClose && this.onWillClose();
    send(this.client, intent.UNS_REQ, {topic: this.topic});
  }

  onWillSubscribe(){}
  onSubRejected(){}
  onWillClose(){}
}
