chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processDownload') {
    const { link, filename, smsContent } = request.data;
    const logStatus = (message, type = 'info') => {
      chrome.runtime.sendMessage({ 
        action: 'log', 
        message,
        type 
      });
    };

    let downloadStarted = false;
    logStatus('开始处理下载流程...');

    // 首先访问链接页面
    chrome.tabs.create({ url: link, active: false }, async (tab) => {
      try {
        logStatus('1. 正在打开目标页面...');
        
        // 等待页面加载完成
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('页面加载超时'));
          }, 20000);

          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              clearTimeout(timeout);
              resolve();
            }
          });
        });

        logStatus('2. 页面加载完成，等待3秒...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 检查页面状态并点击查看详情按钮
        logStatus('3. 查找并点击【查看文书详情】按钮...');
        const viewResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: async () => {
            const buttons = Array.from(document.querySelectorAll('button, a'));
            console.log('找到的按钮:', buttons.map(b => b.textContent));
            
            const viewButton = buttons.find(
              button => button.textContent.includes('查看文书详情')
            );

            if (viewButton) {
              viewButton.click();
              return { success: true, message: '找到并点击了按钮' };
            }
            return { 
              success: false, 
              message: '未找到查看文书详情按钮',
              buttons: buttons.map(b => ({
                text: b.textContent,
                tag: b.tagName,
                visible: b.offsetParent !== null
              }))
            };
          }
        });

        if (!viewResult[0].result.success) {
          throw new Error(`查找文书详情按钮失败: ${JSON.stringify(viewResult[0].result)}`);
        }

        logStatus('4. 已点击查看文书详情按钮，等待页面跳转...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 检查新页面是否加载完成
        logStatus('5. 检查新页面状态...');
        const pageStatus = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            return {
              url: window.location.href,
              title: document.title,
              readyState: document.readyState
            };
          }
        });
        logStatus(`当前页面状态: ${JSON.stringify(pageStatus[0].result)}`);

        // 等待确保页面完全加载
        logStatus('6. 等待页面元素加载...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 查找下载按钮
        logStatus('7. 查找【下载】按钮...');
        const downloadResult = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: async () => {
            // 获取所有可能的按钮元素
            const elements = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], [class*="download"], [id*="download"]'));
            console.log('页面上的所有可能按钮:', elements);

            // 记录页面状态
            const pageInfo = {
              url: window.location.href,
              title: document.title,
              buttons: elements.map(el => ({
                text: el.textContent,
                tag: el.tagName,
                classes: el.className,
                id: el.id,
                visible: el.offsetParent !== null,
                role: el.getAttribute('role')
              }))
            };

            // 多种方式查找下载按钮
            let downloadButton = null;

            // 1. 通过文本内容查找
            downloadButton = elements.find(el => 
              el.textContent.includes('下载') && 
              el.offsetParent !== null
            );

            // 2. 通过class名称查找
            if (!downloadButton) {
              downloadButton = document.querySelector('.download, .download-btn, [class*="download"]');
            }

            // 3. 通过aria标签查找
            if (!downloadButton) {
              downloadButton = document.querySelector('[aria-label*="下载"], [title*="下载"]');
            }

            if (downloadButton) {
              try {
                downloadButton.click();
                return { 
                  success: true, 
                  message: '找到并点击了下载按钮',
                  buttonInfo: {
                    text: downloadButton.textContent,
                    tag: downloadButton.tagName,
                    classes: downloadButton.className
                  }
                };
              } catch (e) {
                return { 
                  success: false, 
                  message: `点击按钮失败: ${e.message}`,
                  pageInfo 
                };
              }
            }

            return { 
              success: false, 
              message: '未找到下载按钮',
              pageInfo
            };
          }
        });

        const result = downloadResult[0].result;
        if (!result.success) {
          logStatus('❌ 下载按钮查找失败');
          logStatus('页面信息：');
          logStatus(JSON.stringify(result.pageInfo, null, 2));
          throw new Error(result.message);
        }

        // 获取文书类型
        logStatus('4. 正在获取文书类型...');
        try {
            const docTypeResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                function: () => {
                    try {
                        const debugInfo = {
                            title: document.title || 'no title',
                            url: window.location.href || 'no url',
                            elements: []
                        };

                        let docType = null;
                        let methodUsed = '';

                        // 查找所有 cell 类元素
                        const cells = Array.from(document.querySelectorAll('.cell'));
                        
                        // 记录所有 cell 的位置和内容用于调试
                        const cellsInfo = cells.map((cell, index) => ({
                            index,
                            text: cell.textContent.trim(),
                            position: {
                                row: cell.closest('tr')?.rowIndex,
                                cell: cell.cellIndex
                            }
                        }));
                        debugInfo.cellsInfo = cellsInfo;

                        // 找到"文书类型"所在的单元格
                        const typeCell = cells.find(cell => cell.textContent.trim() === '文书类型');
                        
                        if (typeCell) {
                            // 获取所有行
                            const rows = Array.from(document.querySelectorAll('tr'));
                            // 找到"文书类型"所在的列索引
                            const typeCellIndex = Array.from(typeCell.parentElement.children).indexOf(typeCell);
                            
                            // 找到"文书类型"所在的行索引
                            const typeRowIndex = rows.indexOf(typeCell.closest('tr'));
                            
                            // 获取下一行同列的单元格内容
                            if (typeRowIndex !== -1 && typeCellIndex !== -1 && typeRowIndex + 1 < rows.length) {
                                const nextRow = rows[typeRowIndex + 1];
                                const cells = Array.from(nextRow.children);
                                if (typeCellIndex < cells.length) {
                                    docType = cells[typeCellIndex].textContent.trim();
                                    methodUsed = '纵向查找';
                                }
                            }

                            debugInfo.search = {
                                typeLocation: {
                                    row: typeRowIndex,
                                    column: typeCellIndex
                                },
                                foundValue: docType
                            };
                        }

                        // 添加表格结构信息用于调试
                        debugInfo.tableStructure = Array.from(document.querySelectorAll('tr')).map(row => ({
                            rowIndex: row.rowIndex,
                            cells: Array.from(row.children).map(cell => ({
                                text: cell.textContent.trim(),
                                columnIndex: cell.cellIndex
                            }))
                        }));

                        return {
                            success: !!docType,
                            type: docType || '',
                            message: docType 
                                ? `找到文书类型: ${docType} (${methodUsed})` 
                                : '未找到文书类型',
                            debug: {
                                ...debugInfo,
                                methodUsed,
                                foundType: docType
                            }
                        };
                    } catch (e) {
                        return {
                            success: false,
                            type: '',
                            message: `执行出错: ${e.message}`,
                            debug: {
                                error: e.message,
                                stack: e.stack
                            }
                        };
                    }
                }
            });

            // 安全地获取和处理结果
            if (!docTypeResult || !docTypeResult[0] || !docTypeResult[0].result) {
                logStatus('⚠️ 获取文书类型失败: 无有效结果', 'warning');
                throw new Error('获取文书类型失败');
            }

            const typeResult = docTypeResult[0].result;
            
            // 输出调试信息
            logStatus('页面分析结果:', 'info');
            if (typeResult.debug) {
                if (typeResult.debug.pageInfo) {
                    logStatus(`页面信息: ${JSON.stringify(typeResult.debug.pageInfo)}`, 'info');
                }
                if (typeResult.debug.elements) {
                    logStatus(`找到 ${typeResult.debug.elements.length} 个相关元素`, 'info');
                    typeResult.debug.elements.forEach((el, i) => {
                        logStatus(`元素 ${i + 1}: ${JSON.stringify(el)}`, 'info');
                    });
                }
            }

            if (typeResult.success) {
                logStatus(`✓ 文书类型: ${typeResult.type}`, 'success');
            } else {
                logStatus(`⚠️ ${typeResult.message}`, 'warning');
            }

            // 构建最终文件名
            const docType = typeResult.success ? typeResult.type : '';
            const finalFilename = docType ? `${filename}_${docType}` : filename;
            logStatus(`5. 最终文件名将为: ${finalFilename}`);

            // 设置下载监听器
            logStatus('6. 设置下载监听...');
            const downloadPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('下载超时'));
                }, 30000);

                const downloadListener = (downloadItem) => {
                    if (downloadStarted) return;
                    downloadStarted = true;
                    
                    logStatus('8. 检测到下载开始...');
                    chrome.downloads.onCreated.removeListener(downloadListener);
                    clearTimeout(timeout);

                    chrome.downloads.download({
                        url: downloadItem.url,
                        filename: `${filename}/${finalFilename}.pdf`,
                        saveAs: false
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            chrome.downloads.cancel(downloadItem.id);
                            logStatus('9. 使用新文件名下载中...');
                            resolve(downloadId);
                        }
                    });
                };
                
                chrome.downloads.onCreated.addListener(downloadListener);
            });

            // 等待下载完成
            await downloadPromise;
            logStatus('14. 下载完成！');
            
            // 关闭临时标签页
            chrome.tabs.remove(tab.id);
            logStatus('15. 临时标签页已关闭');
            sendResponse({ success: true });

        } catch (error) {
            logStatus(`❌ 处理文书类型时出错: ${error.message}`, 'error');
            throw error;
        }

      } catch (error) {
        logStatus(`❌ 错误: ${error.message}`);
        if (tab) {
          // 在关闭标签页前截图（用于调试）
          try {
            const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId);
            logStatus(`页面截图: ${screenshot}`);
          } catch (e) {
            logStatus('截图失败: ' + e.message);
          }
          chrome.tabs.remove(tab.id);
          logStatus('已关闭临时标签页');
        }
        sendResponse({ success: false, error: error.message });
      }
    });

    return true;
  }
});

// 处理日志消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'log') {
    chrome.runtime.sendMessage({
      action: 'updateLog',
      message: message.message
    });
  }
});
