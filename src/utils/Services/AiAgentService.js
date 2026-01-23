import OpenAI from "openai";

class AiAgentService {
    constructor(uuid) {
        this.uuid = uuid;

        this.openai = null;

        this.loopFlag = true;

        this.initOpenAI();
    }

    isMine(uuid) {
        if(this.uuid == uuid)
            return true;
        return false;
    }

    initOpenAI() {
        this.openai = new OpenAI({
            // 若没有配置环境变量，请用阿里云百炼API Key将下行替换为：apiKey: "sk-xxx",
            // 新加坡和北京地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
            apiKey: import.meta.env.VITE_DASHSCOPE_API_KEY,
            dangerouslyAllowBrowser: true,
            // 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1
            baseURL: import.meta.env.VITE_DASHSCOPE_API_URL
        });
    }

    /**
     * 发送
     * @param {*} model 
     * @param {*} system 
     * @param {*} question 
     */
    async sendQuestion(uuid,model,system,question,targetLang,CallBack,config) {
        let isAnswering = false;

        const messages = [ {"role": "system", "content": system} ];
        /// 增加上下文入参数
        if(config.beContext && config.beContext.length > 0) {
            messages.push(...config.beContext);
        }
        messages.push({"role": "user", "content": (targetLang?"翻译成"+targetLang:"") + question });
        //console.log(messages);

        const stream = await this.openai.chat.completions.create({
            model: model,
            messages,
            enable_thinking: config.enable_thinking,
            stream: true,
            stream_options: {
                include_usage: true
            },
            top_p: 0.0001,
            temperature: config.temperature,
            enable_search: config.enable_search
        });

        /// 流式输出数据
        for await (const chunk of stream) {
            if (!this.loopFlag) break;
            if (!chunk.choices?.length) {
                continue;
            }

            const delta = chunk.choices[0].delta;
            
            // Only collect reasoning content
            if (delta.reasoning_content !== undefined && delta.reasoning_content !== null) {
                reasoningContent += delta.reasoning_content;
            }

            // Receive content, start responding
            if (delta.content !== undefined && delta.content) {
                if (!isAnswering) {
                    isAnswering = true;
                }
                CallBack && CallBack(uuid, delta.content, isAnswering);
            }
        }

        CallBack && CallBack(uuid, '', false);
    }
}
export default AiAgentService;