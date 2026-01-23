class VoiceText {
    constructor(date, uuid, voiceText, status, targetLang) {
        this.date = date;
        this.uuid = uuid;
        this.voiceText = voiceText;
        this.status = status;
        this.targetLang = targetLang;
        this.answerText = '';
        this.isAnswer = true;
    }

    isMine(uuidCu) {
        if(this.uuid == uuidCu)
            return true;
        return false;
    }

    addVoiceAnswer(answerText, isAnswer) {
        if(answerText)
            this.answerText += answerText;
        if(this.isAnswer != isAnswer)
            this.isAnswer = isAnswer;
    }
}
export default VoiceText;