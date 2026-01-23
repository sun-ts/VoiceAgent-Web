class IatResult {
    constructor(uuid) {
        this.uuid = uuid;
        this.iatResult = [];
    }

    isMine(uuidCu) {
        if(this.uuid == uuidCu)
            return true;
        return false;
    }
}
export default IatResult;