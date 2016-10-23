"use strict";

import assign from 'object-assign';

export default function send(client, intent, payload, auth){
  client.didConnect.then(() =>
    client.sock.send(JSON.stringify({
      intent,
      payload: assign({}, payload, {auth: client.credentials}, {auth})
    }));
  );
};
