// scraper.js

const puppeteer = require('puppeteer-extra');
const { TimeoutError } = require('puppeteer');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

puppeteer.use(StealthPlugin());

// --- Cấu hình ---
const BASE_URL = "https://moewalls.com/category/anime/";
const OUTPUT_FILE = "results.json";
const SEEN_LINKS_FILE = "seen_links.txt";
const TARGET_ITEM_COUNT = 3500;     // <<<--- MỤC TIÊU DỪNG LẠI
const MAX_CONCURRENT_PAGES = 4;    // Số worker chạy đồng thời
const PAGE_TIMEOUT = 60000;      // Timeout 60 giây

// --- Các hàm tiện ích (Đầy đủ) ---
async function loadJSON(filePath) {
    try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        return {
            videos: Array.isArray(parsed.videos) ? parsed.videos : [],
            images: Array.isArray(parsed.images) ? parsed.images : [],
            gifs: Array.isArray(parsed.gifs) ? parsed.gifs : [],
        };
    } catch (error) {
        // Nếu file không tồn tại hoặc lỗi, trả về cấu trúc rỗng
        return { videos: [], images: [], gifs: [] };
    }
}

async function loadSeenLinks(filePath) {
    try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, 'utf-8');
        return new Set(data.split(os.EOL).filter(Boolean));
    } catch (error) {
        return new Set();
    }
}

async function saveJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function saveSeenLinks(filePath, seenSet) {
    const sortedLinks = Array.from(seenSet).sort();
    await fs.writeFile(filePath, sortedLinks.join(os.EOL), 'utf-8');
}

// --- Hệ thống Log (Đầy đủ) ---
const status = {
    phase: 'Khởi động...',
    listPageProgress: '',
    detailPageProgress: '',
    stats: { total: 0, videos: 0, images: 0, gifs: 0 },
    recentLogs: [],
};

function addToLog(message) {
    status.recentLogs.unshift(`[${new Date().toLocaleTimeString()}] ${message}`);
    if (status.recentLogs.length > 10) {
        status.recentLogs.pop();
    }
}

function renderDashboard() {
    process.stdout.write('\x1B[2J\x1B[0;0H');
    status.stats.total = status.stats.videos + status.stats.images + status.stats.gifs;
    const target = TARGET_ITEM_COUNT > 0 ? TARGET_ITEM_COUNT : status.stats.total || 1;
    const rawProgress = (status.stats.total / target) * 20;
    const progress = Math.min(20, Math.round(rawProgress));
    const progressBar = '█'.repeat(progress) + '░'.repeat(20 - progress);

    console.log("================ MoeWalls Scraper v9.0 (Direct WebM) =============");
    console.log(` Trạng thái: ${status.phase}`);
    console.log("----------------------------------------------------");
    console.log(` Tiến trình quét trang: ${status.listPageProgress}`);
    console.log(` Hàng đợi xử lý chi tiết: ${status.detailPageProgress}`);
    console.log("----------------------------------------------------");
    console.log(` Thống kê (Tổng: ${status.stats.total} / ${TARGET_ITEM_COUNT > 0 ? TARGET_ITEM_COUNT : '∞'}) [${progressBar}]`);
    console.log(`   - Videos: ${status.stats.videos}`);
    console.log(`   - Images: ${status.stats.images}`);
    console.log(`   - Gifs:   ${status.stats.gifs}`);
    console.log("----------------------------------------------------");
    console.log(" Hoạt động gần nhất:");
    status.recentLogs.forEach(log => console.log(`   ${log}`));
    console.log("====================================================");
    console.log(` Cập nhật lúc: ${new Date().toLocaleString()}`);
}


// --- Logic Worker (Lấy thông tin chi tiết của Video) ---
const detailUrlQueue = [];
let isProducerDone = false;

async function worker(id, browser, seenLinks, results) {
    const totalItems = () => results.videos.length + results.images.length + results.gifs.length;

    while (true) {
        if (TARGET_ITEM_COUNT > 0 && totalItems() >= TARGET_ITEM_COUNT) {
            addToLog(`Worker #${id} dừng vì đã đạt mục tiêu chung.`);
            break;
        }

        if (detailUrlQueue.length === 0) {
            if (isProducerDone) {
                addToLog(`Worker #${id} không còn việc, kết thúc.`);
                break;
            }
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        const pageUrl = detailUrlQueue.shift();
        if (!pageUrl) continue;

        let page;
        try {
            page = await browser.newPage();
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                if (['font', 'image', 'stylesheet'].includes(req.resourceType())) req.abort();
                else req.continue();
            });

            await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT });

            // =========== LOGIC LẤY LINK ĐÃ ĐƯỢC THAY ĐỔI THEO YÊU CẦU ===========
            const videoData = await page.evaluate((url) => {
                const data = {
                    title: document.querySelector('h1.entry-title')?.innerText.trim() || 'No Title',
                    pageUrl: url,
                    thumbnailUrl: null,
                    media: { mp4: null, webm: null },
                };

                // Lấy thumbnail
                const posterElement = document.querySelector('div.vidmain video.vjs-tech');
                if (posterElement && posterElement.poster) {
                    data.thumbnailUrl = posterElement.poster.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp))$/i, '$1');
                }

                // LẤY TRỰC TIẾP link webm từ trình phát video
                // Selector này tìm thẻ <source> có thuộc tính `src` chứa đuôi ".webm"
                const videoSource = document.querySelector('div.vidmain video.vjs-tech > source[src*=".webm"]');
                if (videoSource && videoSource.src) {
                    data.media.webm = videoSource.src;
                }

                return data;
            }, pageUrl);
            // =================== KẾT THÚC THAY ĐỔI LOGIC ===================

            if (videoData.media.webm) {
                if (TARGET_ITEM_COUNT === 0 || totalItems() < TARGET_ITEM_COUNT) {
                    results.videos.push(videoData);
                    status.stats.videos++;
                    addToLog(`[+] Video: ${videoData.title}`);
                }
            } else {
                addToLog(`[!] Không tìm thấy video WEBM tại: ${pageUrl.slice(-40)}`);
            }
        } catch (error) {
            if (error instanceof TimeoutError) addToLog(`LỖI Timeout: ${pageUrl.slice(-40)}`);
            else addToLog(`Lỗi worker: ${pageUrl.slice(-40)} - ${error.message.split('\n')[0]}`);
        } finally {
            if (page && !page.isClosed()) await page.close();
            status.detailPageProgress = `${detailUrlQueue.length} item đang chờ`;
        }
    }
}


// --- Hàm điều khiển chính (runScraper) ---
async function runScraper() {
    let dashboardInterval = setInterval(renderDashboard, 1000);
    const results = await loadJSON(OUTPUT_FILE);
    const seenLinks = await loadSeenLinks(SEEN_LINKS_FILE);

    results.videos.forEach(item => seenLinks.add(item.pageUrl));
    results.images.forEach(item => seenLinks.add(item.url));
    results.gifs.forEach(item => seenLinks.add(item.url));

    status.stats = {
        videos: results.videos.length,
        images: results.images.length,
        gifs: results.gifs.length,
    };

    const totalItems = () => status.stats.videos + status.stats.images + status.stats.gifs;

    if (TARGET_ITEM_COUNT > 0 && totalItems() >= TARGET_ITEM_COUNT) {
        status.phase = 'Đã đạt mục tiêu từ trước. Dừng lại.';
        clearInterval(dashboardInterval);
        renderDashboard();
        return;
    }

    let browser;
    try {
        status.phase = 'Khởi động trình duyệt...';
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        });

        const workerPromises = [];
        for (let i = 1; i <= MAX_CONCURRENT_PAGES; i++) {
            workerPromises.push(worker(i, browser, seenLinks, results));
        }

        status.phase = 'Đang quét trang danh sách...';
        let currentPageUrl = BASE_URL;
        let pageCount = 1;
        isProducerDone = false;

        try {
            while (currentPageUrl) {
                if (TARGET_ITEM_COUNT > 0 && totalItems() >= TARGET_ITEM_COUNT) {
                    addToLog('Đã đạt mục tiêu. Dừng quét trang danh sách.');
                    break;
                }

                status.listPageProgress = `Trang ${pageCount}...`;
                status.detailPageProgress = `${detailUrlQueue.length} item đang chờ`;
                const page = await browser.newPage();
                try {
                    await page.goto(currentPageUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT });
                    const itemsData = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('ul.g1-collection-items > li.g1-collection-item'))
                            .map(item => {
                                if (item.classList.contains('g1-injected-unit')) return null;
                                const linkElement = item.querySelector('a.g1-frame');
                                const titleElement = item.querySelector('h3.entry-title a');
                                if (!linkElement || !titleElement) return null;
                                const href = linkElement.href;
                                const title = titleElement.innerText.trim();
                                const thumbnail = item.querySelector('.entry-featured-media img')?.src.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp))$/i, '$1');
                                if (href.toLowerCase().endsWith('.gif')) {
                                    return { type: 'gif', title, url: href, thumbnailUrl: thumbnail };
                                } else if (/\.(jpg|jpeg|png|webp)$/i.test(href)) {
                                    return { type: 'image', title, url: href, thumbnailUrl: thumbnail };
                                } else {
                                    return { type: 'detail_page', url: href };
                                }
                            }).filter(Boolean);
                    });

                    if (itemsData.length === 0) {
                        addToLog(`Trang ${pageCount} không có mục nào. Dừng quét.`);
                        break;
                    }

                    let newLinksFoundInPage = 0;
                    for (const item of itemsData) {
                        if (TARGET_ITEM_COUNT > 0 && totalItems() >= TARGET_ITEM_COUNT) {
                            break;
                        }
                        const checkUrl = item.type === 'detail_page' ? item.url : item.url;
                        if (seenLinks.has(checkUrl)) continue;
                        newLinksFoundInPage++;
                        seenLinks.add(checkUrl);

                        if (TARGET_ITEM_COUNT === 0 || totalItems() < TARGET_ITEM_COUNT) {
                            switch (item.type) {
                                case 'detail_page':
                                    detailUrlQueue.push(item.url);
                                    break;
                                case 'image':
                                    results.images.push({ title: item.title, url: item.url, thumbnailUrl: item.thumbnailUrl });
                                    status.stats.images++;
                                    addToLog(`[+] Image: ${item.title}`);
                                    break;
                                case 'gif':
                                    results.gifs.push({ title: item.title, url: item.url, thumbnailUrl: item.thumbnailUrl });
                                    status.stats.gifs++;
                                    addToLog(`[+] GIF: ${item.title}`);
                                    break;
                            }
                        }
                    }
                    if (newLinksFoundInPage === 0 && pageCount > 1) {
                        addToLog(`Trang ${pageCount} toàn link cũ. Đã quét hết dữ liệu mới.`);
                        break;
                    }
                } catch (error) {
                    addToLog(`Lỗi quét trang ${pageCount}: ${error.message.split('\n')[0]}. Dừng quét.`);
                    break;
                } finally {
                    if (page && !page.isClosed()) await page.close();
                }

                pageCount++;
                currentPageUrl = `${BASE_URL}page/${pageCount}/`;
            }
        } finally {
            if (TARGET_ITEM_COUNT > 0 && totalItems() >= TARGET_ITEM_COUNT) {
                addToLog(`Đạt mục tiêu. Xóa ${detailUrlQueue.length} item còn lại trong hàng đợi.`);
                detailUrlQueue.length = 0;
            }
            isProducerDone = true;
            status.phase = 'Quét xong. Chờ xử lý nốt các mục còn lại...';
        }

        await Promise.all(workerPromises);

        status.phase = 'Hoàn tất! Đang lưu kết quả...';
        renderDashboard();

        await saveJSON(OUTPUT_FILE, results);
        await saveSeenLinks(SEEN_LINKS_FILE, seenLinks);
        addToLog('Đã lưu kết quả thành công.');
        status.phase = 'Đã xong!';

    } catch (error) {
        status.phase = 'LỖI NGHIÊM TRỌNG!';
        addToLog(error.stack);
        console.error("Đã xảy ra lỗi không thể phục hồi:", error);
    } finally {
        if (browser) await browser.close();
        clearInterval(dashboardInterval);
        renderDashboard();
    }
}


// --- Vòng lặp chính ---
(async () => {
    await runScraper();
    console.log(`\nPhiên quét đã hoàn tất lúc ${new Date().toLocaleString()}.`);
    console.log(`Kết quả được lưu vào file "${OUTPUT_FILE}".`);
})();