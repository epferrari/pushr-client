"use strict";

export default function pick(obj, props){
	return Object.keys(obj).reduce((acc, key) => {
		if(props.includes(key)){
			acc[key] = obj[key];
		}
		return acc;
	}, {});
};
