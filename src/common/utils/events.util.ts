import EventEmitter from 'events';

const eventEmitter = new EventEmitter();

export const listenEvent = (
  eventName: string | symbol,
  listener: (...args: any[]) => void,
) => {
  eventEmitter.on(eventName, listener);
};

export const emitEvent = (eventName: string | symbol, data: any) => {
  eventEmitter.emit(eventName, data);
};
