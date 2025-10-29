(function () {
  "use strict";

  // Load Chart.js from CDN
  function loadChartJs() {
    return new Promise((resolve, reject) => {
      if (window.Chart) {
        resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Chart.jsの読み込みに失敗しました"));
      document.head.appendChild(script);
    });
  }

  function fetchBarChartDataAndRender() {
    const appId = kintone.app.getId();
    const ctx = document.getElementById('bar-chart').getContext('2d');

    kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: appId,
      size: 500,
    })
      .then(resp => {
        const records = resp.records;
        const labels = [];
        const afterData = [];
        const reducedData = []; // 削減分

        records.forEach(record => {
          const flowName = record["業務名"].value.trim() || '(無名)';
          const manualBefore = Number(record["手動工数_ビフォー"].value) || 0;
          const manualAfter = Number(record["手動工数_アフター"].value) || 0;

          labels.push(flowName);
          afterData.push(manualAfter);
          reducedData.push(manualBefore - manualAfter);
        });

        if (window.barChartInstance) {
          window.barChartInstance.destroy();
        }

        window.barChartInstance = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'アフター工数',
                data: afterData,
                backgroundColor: 'rgba(255, 99, 132, 0.8)',
                stack: '工数',
                barPercentage: 0.5,
                categoryPercentage: 0.6,
              },
              {
                label: '削減工数（ビフォーとの差）',
                data: reducedData,
                backgroundColor: 'rgba(54, 162, 235, 0.8)',
                stack: '工数',
                barPercentage: 0.5,
                categoryPercentage: 0.6,
              }
            ]
          },
          options: {
            responsive: false,
            plugins: {
              title: {
                display: true,
                text: '自動化による工数の視覚化'
              },
              legend: {
                display: false
              },
              tooltip: {
                callbacks: {
                  label: function (context) {
                    const index = context.dataIndex;
                    const after = afterData[index];
                    const reduced = reducedData[index];
                    const before = after + reduced;

                    if (context.dataset.label === '削減工数（ビフォーとの差）') {
                      return [`ビフォー: ${before} 分`];
                    } else {
                      return `アフター: ${after} 分`;
                    }
                  }
                }
              }
            },
            scales: {
              x: { stacked: true },
              y: {
                stacked: true,
                beginAtZero: true,
                title: {
                  display: true,
                  text: '工数（分）'
                }
              }
            }
          }
        });
      })
      .catch(err => {
        console.error('Bar chart data取得失敗:', err);
      });
  }

  kintone.events.on("app.record.index.show", function (event) {
    const headerSpace = kintone.app.getHeaderSpaceElement();
    headerSpace.innerHTML = "";

    const anotherAppId = 147; // 置き換えてください

    // App 147からデータ取得（実行開始フィールドでフィルタ）
    function fetchChartDataFromApp147(daysAgo) {
      return new Promise((resolve, reject) => {
        let query = "";

        if (daysAgo === "1month") {
          const today = new Date();
          const fromDate = new Date(today);
          fromDate.setMonth(fromDate.getMonth() - 1);
          const isoDateFrom = fromDate.toISOString().split("T")[0];
          const isoDateTo = today.toISOString().split("T")[0];
  
          query = `実行開始 >= "${isoDateFrom}" and 実行開始 <= "${isoDateTo}"`;
        } else if (typeof daysAgo === "number" && daysAgo > 0) {
          const dateFrom = new Date();
          dateFrom.setDate(dateFrom.getDate() - daysAgo);
          const isoDateFrom = dateFrom.toISOString().split("T")[0];
          query = `実行開始 >= "${isoDateFrom}"`;
        }

        const params = {
          app: anotherAppId,
          size: 500,
        };
        if (query) params.query = query;

        kintone.api(kintone.api.url("/k/v1/records", true), "GET", params)
          .then(resp => {
            let countRunning = 0;
            let countStopped = 0;

            resp.records.forEach((record, index) => {
              const statusField = record["color"]; // フィールドコードを確認してください
              if (!statusField || !statusField.value) {
                console.log(`Record ${index + 1} ステータス field missing or empty`);
                return;
              }

              const status = statusField.value;
              if (status === "成功" || status === "実行中") {
                countRunning++;
              } else if (status === "失敗" || status === "停止中") {
                countStopped++;
              }
            });

            resolve([
              { label: "成功", value: countRunning },
              { label: "失敗", value: countStopped },
            ]);
          })
          .catch(error => {
            console.error("Error fetching data from app 147:", error);
            reject(new Error("App 147からのデータ取得に失敗しました。アプリID、権限、フィールドコードを確認してください。"));
          });
      });
    }

    // 現アプリのステータス件数取得（フィルタ用）
    function fetchStatusCounts() {
      return new Promise((resolve, reject) => {
        const params = {
          app: kintone.app.getId(),
          fields: ["ステータス"],
          size: 500,
        };

        kintone.api(kintone.api.url("/k/v1/records", true), "GET", params)
          .then(resp => {
            let countRunning = 0;
            let countStopped = 0;

            resp.records.forEach((record) => {
              if (!record["ステータス"] || !record["ステータス"].value) return;

              const status = record["ステータス"].value;
              if (status === "実行中") countRunning++;
              else if (status === "停止中") countStopped++;
            });

            resolve({ running: countRunning, stopped: countStopped });
          })
          .catch(error => {
            console.error("Error fetching current app status counts:", error);
            reject(error);
          });
      });
    }

    // Chart.jsでドーナツ型チャート描画（中央に稼働率表示）
    function renderChart(data) {
      const canvas = document.getElementById("kintone-chart");
      if (!canvas) {
        console.error("Canvas element for chart not found");
        return;
      }
      const ctx = canvas.getContext("2d");

      if (window.myChart) {
        window.myChart.destroy();
      }

      const total = data.reduce((sum, item) => sum + item.value, 0);
      const successCount = data.find(item => item.label === "成功")?.value || 0;
      const utilization = total > 0 ? Math.round((successCount / total) * 100) : 0;

      // 中央テキスト描画用プラグイン
      const centerTextPlugin = {
        id: 'centerText',
        afterDraw(chart) {
          const { ctx, chartArea: { left, right, top, bottom } } = chart;
          ctx.save();

          const text = utilization.toString();
          ctx.font = 'bold 40px Arial';
          ctx.fillStyle = '#000';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          const centerX = (left + right) / 2;
          const centerY = (top + bottom) / 2;

          ctx.fillText(text, centerX, centerY);
          ctx.restore();
        }
      };

      window.myChart = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels: data.map((item) => item.label),
          datasets: [
            {
              label: "ステータス別件数",
              data: data.map((item) => item.value),
              backgroundColor: ["#4CAF50", "#B71C1C"],
              borderColor: "#fff",
              borderWidth: 1,
            },
          ],
        },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: {
            legend: { position: "right" },
            tooltip: {
              callbacks: {
                label: function (context) {
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const value = context.parsed;
                  const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                  return `${context.label}: ${value} (${percent}%)`;
                },
              },
            },
          },
        },
        plugins: [centerTextPlugin],
      });
    }

    // チャート表示・非表示切り替え関数
    function toggleChartVisibility(show) {
      const chartDiv = document.getElementById("chart");
      if (!chartDiv) return;

      if (show) {
        chartDiv.style.display = "block";
        chartDiv.style.flex = "1";
        chartDiv.style.visibility = "visible";
      } else {
        chartDiv.style.display = "block";
        chartDiv.style.flex = "1";
        chartDiv.style.visibility = "hidden";
      }
    }

    // 日付フィルタボタンにイベント登録
    function addDateFilterListeners() {
      const buttons = [
        { id: "filter-1day", days: 1 },
        { id: "filter-7days", days: 7 },
        { id: "filter-1month", days: "1month" },
      ];

      buttons.forEach(({ id, days }) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.onclick = function () {
          fetchChartDataFromApp147(days)
            .then((chartData) => {
              renderChart(chartData);
            })
            .catch((err) => {
              console.error("Failed to update chart with date filter:", err);
            });
        };
      });
    }

    // 初期処理
    loadChartJs()
      .then(() => Promise.all([fetchChartDataFromApp147("1month"), fetchStatusCounts()]))
      .then(function ([chartData, statusCounts]) {
        headerSpace.innerHTML = `
          <div style="width: 100%; box-sizing: border-box; padding-bottom: 10px;">
            <div style="
              display: flex;
              width: 100%;
              height: 320px;
              gap: 20px;
              box-sizing: border-box;
            ">
            
              <!-- Filter Buttons -->
              <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; border: 1px solid #ddd; padding: 10px;">
                <div id="filter-running" style="flex: 1; background-color: #4caf50; color: white; border-radius: 8px; text-align: center; cursor: pointer; display: flex; flex-direction: column; justify-content: center;">
                  <div style="font-size: 40px; font-weight: bold;">${statusCounts.running}</div>
                  <div style="font-size: 20px;">実行中表示</div>
                </div>
                <div id="filter-stopped" style="flex: 1; background-color: #f44336; color: white; border-radius: 8px; text-align: center; cursor: pointer; display: flex; flex-direction: column; justify-content: center;">
                  <div style="font-size: 40px; font-weight: bold;">${statusCounts.stopped}</div>
                  <div style="font-size: 20px;">停止中表示</div>
                </div>
                <div id="filter-clear" style="flex: 1; background-color: #888; color: white; border-radius: 8px; text-align: center; cursor: pointer; display: flex; flex-direction: column; justify-content: center;">
                  <div style="font-size: 40px; font-weight: bold;">${statusCounts.running + statusCounts.stopped}</div>
                  <div style="font-size: 20px; font-weight: bold;">全て表示</div>
                </div>
              </div>
              <!-- Pie Chart Area -->
              <div style="flex: 1; border: 1px solid #ddd; padding: 10px;" id="chart">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                  <div style="font-weight: bold;">自動化移動率</div>
                  <div>
                    <button id="filter-1day" style="margin-right: 5px;">1日</button>
                    <button id="filter-7days" style="margin-right: 5px;">7日</button>
                    <button id="filter-1month">一ヶ月</button>
                  </div>
                </div>
                <canvas id="kintone-chart" width="400" height="250"></canvas>
              </div>
            </div>
            <div style="width: 100%; border: 1px solid #ddd; padding: 10px; margin-top: 20px;">
              <div style="font-weight: bold; margin-bottom: 10px;">自動化による工数の視覚化</div>
<div style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center">
<div style="display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; text-align: center;">
  <div style="display: flex; align-items: center; gap: 5px;">
    <span style="display: inline-block; width: 20px; height: 20px; background-color: #f44336;"></span>
    <span>手動工数（ビフォー）</span>
  </div>
  <div style="display: flex; align-items: center; gap: 5px;">
    <span style="display: inline-block; width: 20px; height: 20px; background-color: #36a2eb;"></span>
    <span>手動工数（アフター）
</span>
  </div>
</div>


              <canvas id="bar-chart" style="width: 100%; height: 500px;"></canvas>
            </div>
          </div>
        `;

        const appId = kintone.app.getId();
        const baseUrl = location.protocol + "//" + location.host + location.pathname;

        const filterRunning = document.getElementById("filter-running");
        const filterStopped = document.getElementById("filter-stopped");
        const filterClear = document.getElementById("filter-clear");

        if (filterRunning) {
          filterRunning.onclick = () => {
            location.href = baseUrl + "?app=" + appId + "&query=" + encodeURIComponent('ステータス in ("実行中")');
          };
        }
        if (filterStopped) {
          filterStopped.onclick = () => {
            location.href = baseUrl + "?app=" + appId + "&query=" + encodeURIComponent('ステータス in ("停止中")');
          };
        }
        if (filterClear) {
          filterClear.onclick = () => {
            location.href = baseUrl + "?app=" + appId;
          };
        }

        addDateFilterListeners();

        renderChart(chartData);
        fetchBarChartDataAndRender();

        // URLのクエリ判定してチャート表示切替
        (function () {
          const params = new URLSearchParams(location.search);
          const query = params.get("query");
          if (!query) {
            toggleChartVisibility(true);
          } else {
            toggleChartVisibility(false);
          }
        })();
      })
      .catch(function (error) {
        console.error(error);
        headerSpace.innerHTML = '<div style="color: red;">データの取得に失敗しました。設定を確認してください。</div>';
      });
  });
})();
