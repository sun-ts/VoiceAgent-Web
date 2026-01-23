class AudioText {
    constructor(uuid) {
        this.uuid = uuid;

        this.textPlay = '';

        this.currentNumber = 0;

        this.isOver = false;
    }

    isMine(uuidCu) {
        if(this.uuid == uuidCu)
            return true;
        return false;
    }

    addAudioText(content, isOver) {
        this.textPlay += content;
        this.isOver = isOver;
    }
}
export default AudioText;