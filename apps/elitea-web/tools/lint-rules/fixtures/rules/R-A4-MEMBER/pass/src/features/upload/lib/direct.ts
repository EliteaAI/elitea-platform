interface Transport {
  readonly XMLHttpRequest: new () => object;
}

export function upload(transport: Transport): object {
  const request = new transport.XMLHttpRequest();
  return request;
}
