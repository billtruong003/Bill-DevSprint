import requests
from bs4 import BeautifulSoup
import json
import time
import os
import threading
from queue import Queue

# --- Cấu hình (Không đổi) ---
BASE_URL = "https://moewalls.com/category/anime/"
OUTPUT_FILE = "results.json"
SEEN_LINKS_FILE = "seen_links.txt"
WAIT_INTERVAL = 200
TARGET_VIDEO_COUNT = 500
DETAIL_PAGE_WORKERS = 20

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}
VIDEO_EXTENSIONS = ('.mp4', '.webm', '.mov')
IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png')
GIF_EXTENSIONS = ('.gif',)

# --- Queues và Biến Toàn cục (Không đổi) ---
detail_page_queue = Queue()
all_media_links = {"videos": [], "images": [], "gif": []}
seen_links = set()
lock = threading.Lock()
stop_event = threading.Event()

# --- Các hàm tiện ích (Không đổi) ---
def load_json_file(filename):
    if not os.path.exists(filename): return {"videos": [], "images": [], "gif": []}
    try:
        with open(filename, 'r', encoding='utf-8') as f: return json.load(f)
    except (json.JSONDecodeError, IOError): return {"videos": [], "images": [], "gif": []}

def load_seen_links(filename):
    if not os.path.exists(filename): return set()
    try:
        with open(filename, 'r', encoding='utf-8') as f: return {line.strip() for line in f if line.strip()}
    except IOError: return set()

def save_seen_links(links_set, filename):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            for link in sorted(list(links_set)): f.write(link + '\n')
    except IOError as e: print(f"Lỗi khi lưu file 'trí nhớ' {filename}: {e}")

def save_to_json(data, filename):
    try:
        with open(filename, 'w', encoding='utf-8') as f: json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"\nĐã lưu tổng cộng {len(data['videos'])} video, {len(data['images'])} ảnh, {len(data['gif'])} gif vào '{filename}'")
    except IOError as e: print(f"Lỗi khi lưu file JSON: {e}")

def get_soup(url):
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        return BeautifulSoup(response.text, 'html.parser')
    except requests.exceptions.RequestException: return None

# --- Logic cho các luồng (CÓ THAY ĐỔI) ---

def detail_page_worker():
    while not stop_event.is_set():
        try:
            detail_url = detail_page_queue.get(timeout=1)
        except Exception:
            if stop_event.is_set() and detail_page_queue.empty(): break
            continue

        with lock:
            if detail_url in seen_links:
                detail_page_queue.task_done()
                continue
            seen_links.add(detail_url)

        soup = get_soup(detail_url)
        if not soup:
            detail_page_queue.task_done()
            continue
        
        media_url = None
        download_link_tag = soup.select_one('a.bimber-download-link')
        if download_link_tag and 'href' in download_link_tag.attrs:
            media_url = download_link_tag['href']
        else:
            video_source_tag = soup.select_one('video > source')
            if video_source_tag and 'src' in video_source_tag.attrs:
                media_url = video_source_tag['src']
        
        if media_url:
            with lock:
                if media_url not in seen_links:
                    seen_links.add(media_url)
                    if media_url.lower().endswith(VIDEO_EXTENSIONS):
                        all_media_links["videos"].append(media_url)
                        # *** THAY ĐỔI Ở ĐÂY ***
                        print(f"\n[+] Tìm thấy video #{len(all_media_links['videos'])}: {os.path.basename(media_url)}")
                        if len(all_media_links["videos"]) >= TARGET_VIDEO_COUNT:
                            stop_event.set()
                    elif media_url.lower().endswith(IMAGE_EXTENSIONS):
                        all_media_links["images"].append(media_url)
                    elif media_url.lower().endswith(GIF_EXTENSIONS):
                        all_media_links["gif"].append(media_url)
        detail_page_queue.task_done()

def progress_monitor():
    while not stop_event.is_set():
        with lock:
            current_videos = len(all_media_links['videos'])
        print(f"\r[Tiến độ] Queue: {detail_page_queue.qsize():<5} | Videos: {current_videos}/{TARGET_VIDEO_COUNT} ", end='', flush=True)
        time.sleep(1)
    with lock:
        current_videos = len(all_media_links['videos'])
    print(f"\r[Tiến độ] Xử lý hoàn tất!                                 | Videos: {current_videos}/{TARGET_VIDEO_COUNT}")

# --- Hàm điều khiển chính (Không đổi) ---
def run_scraper_with_page_logging(target_count):
    global all_media_links, seen_links, stop_event
    
    all_media_links = load_json_file(OUTPUT_FILE)
    seen_links = load_seen_links(SEEN_LINKS_FILE)
    stop_event.clear()
    while not detail_page_queue.empty():
        detail_page_queue.get()
    
    print(f"Trạng thái ban đầu: {len(all_media_links['videos'])}/{target_count} videos. 'Trí nhớ': {len(seen_links)} links.")
    if len(all_media_links['videos']) >= target_count:
        print("Đã đạt mục tiêu. Không cần quét.")
        return

    threads = []
    for _ in range(DETAIL_PAGE_WORKERS):
        t = threading.Thread(target=detail_page_worker, daemon=True)
        t.start()
        threads.append(t)
    
    monitor = threading.Thread(target=progress_monitor, daemon=True)
    monitor.start()

    print("\n--- Bắt đầu quét các trang danh sách ---")
    current_page_url = BASE_URL
    page_count = 1
    
    while current_page_url and not stop_event.is_set():
        soup = get_soup(current_page_url)
        if not soup:
            print(f"Lỗi: Không thể lấy dữ liệu từ trang {page_count}, bỏ qua.")
            break
        
        links_on_this_page = soup.select('ul.g1-collection-items article.entry-tpl-grid h3.entry-title a')
        if not links_on_this_page:
            print("Không tìm thấy link nào, có thể đã đến trang cuối.")
            break

        new_links_count = 0
        for link in links_on_this_page:
            detail_url = link.get('href')
            if detail_url:
                with lock:
                    is_seen = detail_url in seen_links
                if not is_seen:
                    detail_page_queue.put(detail_url)
                    new_links_count += 1
        
        print(f"\n[Quét ngoài] Trang {page_count:<3}: Tìm thấy {len(links_on_this_page)} link, đưa {new_links_count} link mới vào hàng đợi.")

        next_page_tag = soup.select_one('a.next.page-numbers')
        current_page_url = next_page_tag['href'] if next_page_tag else None
        page_count += 1

    print("\n--- Đã quét xong các trang danh sách. Chờ xử lý nốt... ---")
    detail_page_queue.join()
    stop_event.set()
    
    for t in threads: t.join(timeout=2)
    monitor.join(timeout=2)

    save_to_json(all_media_links, OUTPUT_FILE)
    save_seen_links(seen_links, SEEN_LINKS_FILE)

# --- Vòng lặp chính (Không đổi) ---
if __name__ == "__main__":
    while True:
        print("=============================================")
        print(f"Bắt đầu phiên quét mới lúc {time.ctime()}")
        run_scraper_with_page_logging(TARGET_VIDEO_COUNT)
        print(f"\nHoàn tất phiên quét. Sẽ chạy lại sau {WAIT_INTERVAL / 60:.0f} phút.")
        try:
            time.sleep(WAIT_INTERVAL)
        except KeyboardInterrupt:
            print("\nĐã nhận lệnh dừng (Ctrl+C). Tạm biệt!")
            break