"use strict";

export default function defineProperty(obj, propName, value){
  Object.defineProperty(obj, propName, {
    value,
    enumerable: false,
    writable: false,
    configurable: false
  });
};
