import { Route } from '@/types';
import { getSubPath } from '@/utils/common-utils';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import { art } from '@/utils/render';
import path from 'node:path';

export const route: Route = {
    path: '/:type/:keyword{.*}?',
    categories: ['multimedia'],
    name: 'JavBee 通用订阅（适配Folo磁力）',
    maintainers: ['cgkings'],
    parameters: { 
        type: '类型：new(最新)/popular(热门)/random(随机)/tag(标签)/date(日期)', 
        keyword: '参数：popular填7/30/60；tag填标签名；date填2025-12-01；new/random留空' 
    },
    handler,
    description: `### 订阅示例
- 最新资源：/javbee/new
- 30天热门：/javbee/popular/30
- 指定标签：/javbee/tag/Adult%20Awards
- 指定日期：/javbee/date/2025-12-01

### 功能说明
1. 适配Folo磁力链接识别，Enclosure规范配置；
2. 截图直链自动剥离随机前缀，加载失败降级；
3. 磁力链接XML转义，避免解析错误。`,
    features: { nsfw: true },
};

async function handler(ctx) {
    let currentUrl;
    const rootUrl = 'https://javbee.vip';
    const timeout = 15000;

    try {
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('keyword') ?? '';

        // 构造请求URL
        if (type === 'popular' && keyword) {
            currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
        } else {
            currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
        }

        // 反爬延迟+请求配置
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
        const response = await got({
            method: 'get',
            url: currentUrl,
            headers: {
                'Referer': rootUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout,
        });

        const $ = load(response.data);
        const items = $('.card .columns')
            .toArray()
            .map((item) => {
                item = $(item);
                const titleEl = item.find('.title.is-4.is-spaced a');
                const videoId = titleEl.text().trim() || '未知ID';
                const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
                
                // 提取日期
                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink?.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    pubDate = /^\d{4}-\d{2}-\d{2}$/.test(extractedDate) ? extractedDate : null;
                }

                // 提取链接
                const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLink = item.find('a[title="Download .torrent"]').attr('href') || '';
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 封面图
                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 截图处理（剥离随机前缀）
                const screenshots = [];
                item.find('.images-description ul li a.img-items').each((_, el) => {
                    const originalScreenshotUrl = $(el).text().trim().replace(/\s+/g, '');
                    if (originalScreenshotUrl.startsWith('https') && originalScreenshotUrl.endsWith('_s.jpg')) {
                        try {
                            const urlObj = new URL(originalScreenshotUrl);
                            const imgHost = urlObj.hostname;
                            let fileName = originalScreenshotUrl.split('/').pop();
                            fileName = fileName.replace(/^[A-Za-z0-9]+-/, ''); // 剥离随机前缀
                            const directUrl = `https://${imgHost}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${fileName}`;
                            
                            screenshots.push({
                                originalUrl: originalScreenshotUrl,
                                directUrl: directUrl,
                                alt: `截图${screenshots.length + 1}`
                            });
                        } catch (e) {
                            screenshots.push({ originalUrl: originalScreenshotUrl, directUrl: originalScreenshotUrl });
                        }
                    }
                });

                // ========== 关键：磁力链接转义+Enclosure配置 ==========
                // XML转义：& → &amp;
                const escapedMagnet = magnet.replace(/&/g, '&amp;');
                const escapedTorrent = torrentLink.replace(/&/g, '&amp;');

                // 构造返回Item
                return {
                    title: `${videoId} ${size}`,
                    pubDate: parseDate(pubDate),
                    link: itemLink,
                    guid: itemLink,
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        coverImage: coverImageUrl,
                        videoId,
                        size,
                        pubDate: pubDate || '未知日期',
                        magnet, // 原链接（description中无需转义）
                        torrentLink,
                        screenshots,
                    }),
                    // 适配Folo的Enclosure配置
                    enclosure: [
                        // 磁力链接Enclosure
                        magnet ? {
                            url: escapedMagnet,
                            type: 'x-scheme-handler/magnet',
                        } : null,
                        // Torrent文件Enclosure
                        torrentLink ? {
                            url: escapedTorrent,
                            type: 'application/x-bittorrent',
                        } : null,
                    ].filter(Boolean), // 过滤空值
                };
            });

        // 容错：空数据处理
        if (items.length === 0) {
            return {
                title: `JavBee - ${type} 资源订阅`,
                link: currentUrl,
                description: '未抓取到资源，请检查站点或稍后重试',
                item: [],
            };
        }

        return {
            title: `JavBee - ${type} 资源订阅`,
            link: currentUrl,
            item: items,
        };

    } catch (error) {
        ctx.status = 500;
        return {
            title: 'JavBee 订阅抓取失败',
            link: currentUrl || rootUrl,
            description: `错误：${error.message}`,
            item: [],
        };
    }
}