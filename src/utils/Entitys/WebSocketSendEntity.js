class WebSocketSendEntity {
    
    constructor(uuid) {
        this.uuid = uuid;
        
        this.WebSocketSendEntitys = [];
    }

    isMine(uuidCu) {
        if(this.uuid == uuidCu)
            return true;
        return false;
    }

    addReadySendData(audioByte, status) {
        this.WebSocketSendEntitys.push({
            audioByte : audioByte,
            status : status
        });
    }

    getReadySendData() {
        return this.WebSocketSendEntitys.shift();
    }
}
export default WebSocketSendEntity;