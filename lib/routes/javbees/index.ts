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
    name: 'JavBee 通用订阅（Folo完全兼容版）',
    maintainers: ['cgkings', 'nczitzk'],
    parameters: { 
        type: '类型，可选值：new(最新)、popular(热门)、random(随机)、tag(指定标签)、date(指定日期)', 
        keyword: '关键词：popular填7/30/60；tag填标签名；date填年月日(2025-11-30)；new/random留空' 
    },
    handler,
    description: `### 订阅示例
- 最新资源：\`/javbee/new\`
- 30天热门：\`/javbee/popular/30\`
- 指定标签：\`/javbee/tag/Adult%20Awards\`（标签空格替换为%20）
- 指定日期：\`/javbee/date/2025-11-30\`
- 随机资源：\`/javbee/random\`

### 功能说明
1. **完全兼容Folo**：修复了导致XML解析失败的三个关键问题。
2. **标准enclosure格式**：使用标准的enclosure对象。
3. **双链接支持**：描述中包含转义后的磁力链接，enclosure使用.torrent文件。
4. **错误处理**：完整的异常捕获和友好错误提示。`,
    features: {
        nsfw: true,
    },
};

// 辅助函数：将文件大小字符串转换为字节数
function parseSizeToBytes(sizeStr) {
    if (!sizeStr) return 0;
    
    const cleanStr = sizeStr.replace(/[()]/g, '').trim().toUpperCase();
    const match = cleanStr.match(/^([\d.]+)\s*([KMG]?B?)$/);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2];
    
    switch (unit) {
        case 'KB':
        case 'K':
            return Math.round(value * 1024);
        case 'MB':
        case 'M':
            return Math.round(value * 1024 * 1024);
        case 'GB':
        case 'G':
            return Math.round(value * 1024 * 1024 * 1024);
        case 'TB':
        case 'T':
            return Math.round(value * 1024 * 1024 * 1024 * 1024);
        default:
            return Math.round(value);
    }
}

async function handler(ctx) {
    let currentUrl;
    const rootUrl = 'https://javbee.vip';
    const timeout = 8000;

    try {
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('keyword') ?? '';

        // 构造请求URL
        if (type === 'popular' && keyword) {
            currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
        } else {
            currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
        }

        // 请求列表页
        const response = await got({
            method: 'get',
            url: currentUrl,
            headers: {
                'Referer': rootUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            timeout,
        });

        const $ = load(response.data);

        // 遍历所有资源条目
        const items = $('.card .columns')
            .toArray()
            .map((item) => {
                item = $(item);

                // 1. 提取基础信息
                const titleEl = item.find('.title.is-4.is-spaced a');
                const videoId = titleEl.text().trim() || '未知ID';
                const sizeText = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '';
                const size = sizeText.replace(/[()]/g, '');
                
                // 2. 提取发布日期
                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink && dateLink.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = extractedDate;
                    }
                }

                // 3. 提取描述
                const description = item.find('.has-text-grey-dark').text().trim();

                // 4. 提取标签
                const tags = item
                    .find('.tags .tag')
                    .toArray()
                    .map((t) => $(t).text().trim())
                    .filter(tag => tag);

                // 5. 提取下载链接
                const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
                const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
                
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 6. 提取封面图
                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 7. 截图处理
                const screenshots = [];
                item.find('.images-description ul li a.img-items').each((_, el) => {
                    const $a = $(el);
                    const originalScreenshotUrl = $a.text().trim().replace(/\s+/g, '');
                    
                    if (originalScreenshotUrl.startsWith('https') && originalScreenshotUrl.endsWith('_s.jpg')) {
                        try {
                            const urlObj = new URL(originalScreenshotUrl);
                            const imgHostDomain = urlObj.hostname;
                            let fullFileName = originalScreenshotUrl.split('/').pop();
                            fullFileName = fullFileName.replace(/^[A-Za-z0-9]+-/, '');
                            const directPreviewUrl = `https://${imgHostDomain}/upload/Application/storage/app/public/uploads/users/aQ2WVGrBGkx7y/${fullFileName}`;

                            screenshots.push({
                                originalUrl: originalScreenshotUrl,
                                directUrl: directPreviewUrl,
                                alt: `截图${screenshots.length + 1}`,
                            });
                        } catch (error) {
                            screenshots.push({
                                originalUrl: originalScreenshotUrl,
                                directUrl: originalScreenshotUrl,
                                alt: `截图${screenshots.length + 1}`
                            });
                        }
                    }
                });

                // ========== 关键修复一：构建 enclosure 对象 ==========
                let enclosure = null;
                const lengthBytes = parseSizeToBytes(size);
                
                // 策略：优先使用.torrent种子文件作为enclosure
                if (torrentLinkRaw) {
                    enclosure = {
                        url: torrentLinkRaw,
                        type: 'application/x-bittorrent',
                        length: lengthBytes.toString(), // 转换为字符串
                    };
                } 
                // 备选：使用磁力链接
                else if (magnetRaw) {
                    enclosure = {
                        url: magnetRaw,
                        type: 'application/x-bittorrent',
                        length: lengthBytes.toString(),
                    };
                }

                // 9. 返回Item（整合所有修复）
                return {
                    title: `${videoId} ${size}`,
                    // 修复1: 确保pubDate总是有效日期
                    pubDate: pubDate ? parseDate(pubDate, 'YYYY-MM-DD') : new Date(),
                    link: itemLink,
                    // 修复2: 生成简洁、唯一、无特殊字符的guid
                    guid: `${videoId}-${lengthBytes}`.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\-]/g, ''),
                    // 修复3: 传递原始磁力链接，避免双重转义
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        image: coverImageUrl,
                        id: videoId,
                        size,
                        pubDate: pubDate || '未知日期',
                        description,
                        tags,
                        // 关键：传递原始链接，XML层会自动转义
                        magnet: magnetRaw,
                        torrent: torrentLinkRaw,
                        screenshots,
                    }),
                    author: tags.join(', '),
                    category: tags,
                    // 关键：必须包含enclosure字段，供Folo生成附件
                    enclosure: enclosure,
                };
            });

        // 生成Feed标题
        const pageTitle = $('title').text().trim();
        const feedTitlePrefix = pageTitle.split('-')[0]?.trim() || type;
        const feedTitle = `JavBee - ${feedTitlePrefix}`;

        return {
            title: feedTitle,
            link: currentUrl,
            item: items,
        };

    } catch (error) {
        return {
            title: 'JavBee 订阅抓取失败',
            link: currentUrl || rootUrl,
            description: `错误原因：${error.message}`,
            item: [],
        };
    }
}