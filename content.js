// 监听页面上的按钮点击
document.addEventListener('click', async (e) => {
  if (e.target.textContent.includes('查看文书详情') || 
      e.target.textContent.includes('下载')) {
    // 通知 background script
    chrome.runtime.sendMessage({
      action: 'buttonClicked',
      text: e.target.textContent
    });
  }
});
