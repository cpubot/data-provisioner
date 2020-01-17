export const isObject = (o: any): o is Record<string, any> =>
  o ? Object.getPrototypeOf(o) === Object.prototype : false;
