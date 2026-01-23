import { createApp } from 'vue'
import router from './router'
import './style.css'
import App from './App.vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import { v7 as uuidv7 } from 'uuid'

const app = createApp(App)

// 初始化全局属性配置
app.config.globalProperties.$uuid = uuidv7;
app.config.globalProperties.$audioEncode = import.meta.env.VITE_XFTTS_ENCODING;
app.config.globalProperties.$isOpeningRemarks = import.meta.env.VITE_IS_OPENING_REMARKS;
app.config.globalProperties.$openingRemarks = import.meta.env.VITE_OPENING_REMARKS;
app.config.globalProperties.$llmPrompt = import.meta.env.VITE_LLM_PROMPT;

app.use(ElementPlus)
app.use(router).mount('#app')
