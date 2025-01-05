class Logger {
  constructor(statusElement, docInfoElement) {
    this.statusElement = statusElement;
    this.docInfoElement = docInfoElement;
  }

  log(message, type = 'info') {
    // 创建新的日志元素
    const logElement = document.createElement('div');
    logElement.className = `log ${type}`;
    
    // 添加时间戳
    const timestamp = new Date().toLocaleTimeString();
    logElement.textContent = `${timestamp} - ${message}`;
    
    // 将日志添加到顶部
    this.statusElement.insertBefore(logElement, this.statusElement.firstChild);
    
    // 更新文档信息显示
    if (message.includes('文书类型:')) {
      this.docInfoElement.innerHTML = `
        <strong>文书类型:</strong> ${message.split('文书类型:')[1].trim()}<br>
        <strong>更新时间:</strong> ${timestamp}
      `;
      // 高亮显示
      this.docInfoElement.style.backgroundColor = '#e6f4ea';
    }

    // 如果是页面分析结果，也显示
    if (message.includes('页面分析结果:')) {
      this.docInfoElement.innerHTML += '<br><strong>正在分析页面...</strong>';
    }

    // 如果是调试信息，也显示
    if (message.includes('找到') && message.includes('个相关元素')) {
      this.docInfoElement.innerHTML += `<br>${message}`;
    }

    // 自动滚动
    this.statusElement.scrollTop = 0;
  }

  clear() {
    this.statusElement.innerHTML = '';
    this.docInfoElement.innerHTML = '等待处理...';
    this.docInfoElement.style.backgroundColor = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const statusElement = document.getElementById('status');
  const docInfoElement = document.getElementById('docInfo');
  const logger = new Logger(statusElement, docInfoElement);
  const button = document.getElementById('processButton');

  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateLog') {
      logger.log(message.message, message.type || 'info');
    } else if (message.action === 'log') {
      logger.log(message.message, message.type || 'info');
    }
  });

  button.addEventListener('click', async () => {
    const smsContent = document.getElementById('smsContent').value;
    
    if (!smsContent) {
      logger.log('请输入短信内容', 'error');
      return;
    }

    try {
      button.disabled = true;
      logger.clear();
      logger.log('开始处理短信内容...');

      // 解析短信内容
      const { link, filename } = extractInfo(smsContent);
      
      if (!link) {
        logger.log('未找到有效链接', 'error');
        button.disabled = false;
        return;
      }

      logger.log(`找到链接: ${link}`);
      logger.log(`基础文件名: ${filename}`);

      // 发送消息给 background script
      chrome.runtime.sendMessage({
        action: 'processDownload',
        data: { link, filename, smsContent }
      }, response => {
        if (response.success) {
          logger.log('处理成功！', 'success');
        } else {
          logger.log(`处理失败：${response.error}`, 'error');
        }
        button.disabled = false;
      });

    } catch (error) {
      logger.log(`处理出错：${error.message}`, 'error');
      button.disabled = false;
    }
  });
});

function extractInfo(smsText) {
  // 提取链接
  const linkMatch = smsText.match(/http[s]?:\/\/[^\s]+/);
  const link = linkMatch ? linkMatch[0] : null;

  // 提取文件名
  const filenameMatch = smsText.match(/（(.*?)号/);
  const filename = filenameMatch ? `（${filenameMatch[1]}号` : null;

  return { link, filename };
}
