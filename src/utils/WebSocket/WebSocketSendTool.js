class WebSocketSendTool {
  constructor(id,xfWebSocketTool,callBack) {
    // 实例属性（原TS的private属性转为JS的实例属性）
    this.websocketid = id;
    this.ws = null;
    this.xfWebSocketTool = xfWebSocketTool;
    this.sendDataInterval = 10; // 重新发送数据的间隔
    this.sendDataInter = null;
    this.sendDataList = [];
    this.sendNullCount = 0;

    // 消息接收回调（供外部使用）
    this.onMessageCallback = callBack;

    this.connect();
  }

  isMine(uuid) {
    if(this.websocketid == uuid) 
      return true;
    return false;
  }

  addSendList(byteAudio, status) {
    let item = { 'byteAudio': byteAudio, 'status': status };
    this.sendDataList.push(item);
  }

  // 建立连接（原private方法转为类内方法）
  connect() {
    this.ws = new WebSocket(this.xfWebSocketTool.getAuthUrl());
    
    this.ws.onopen = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendDataInter = setInterval(() => {
          if (this.sendDataList && this.sendDataList.length > 0) {
            this.sendNullCount = 0;
            let sendData = this.sendDataList.shift();

            this.send(this.xfWebSocketTool.getSendData(
              sendData.byteAudio, sendData.status));

            if (sendData.status == 2) {
              this.clearSendDataInter();
            }
          } else {
            this.sendNullCount++;
            if(this.sendNullCount > 150) {
              console.error('--------长时间未识别到新的待发送数据，系统直接发送识别结束标识！')
              this.send(this.xfWebSocketTool.getSendData("", 2));
              this.clearSendDataInter();
            }
          }
        }, this.sendDataInterval);
      }
    };

    this.ws.onmessage = (event) => {
      // 可通过回调函数传递消息
      this.onMessageCallback && this.onMessageCallback(this.websocketid, event.data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket错误：', error);
      this.ws?.close();
    };
  }

  // 清除重连定时器（原private方法）
  clearSendDataInter() {
    if (this.sendDataInter) {
      //console.log('---------结束计时器的ID是：' + this.sendDataInter)
      clearInterval(this.sendDataInter)
      this.sendDataInter = null;
    }
  }

  // 发送消息
  send(data) {
    const sendData = typeof data === 'object' ? JSON.stringify(data) : data;
    this.ws.send(sendData);
  }

  // 关闭连接
  close() {
    this.clearSendDataInter();
    if (this.ws) {
      this.ws = null;
    }
  }
}

// 导出
export default WebSocketSendTool;