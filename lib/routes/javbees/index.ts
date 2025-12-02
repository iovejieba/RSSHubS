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
    name: 'JavBee 通用订阅 (Folo兼容版)',
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
1. **Folo完全兼容**：已修复导致解析失败的URL转义、日期和类型问题。
2. **标准Enclosure**：使用 \`application/x-bittorrent\` 标准类型。
3. **双链接支持**：描述中包含原始链接，enclosure使用磁力或Torrent文件。
4. **错误处理**：自动生成有效发布日期。`,
    features: {
        nsfw: true,
    },
};

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
                const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
                
                // 2. 提取发布日期
                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink && dateLink.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = extractedDate;
                    }
                }

                // 3. 提取标签
                const tags = item
                    .find('.tags .tag')
                    .toArray()
                    .map((t) => $(t).text().trim())
                    .filter(tag => tag);

                // 4. 提取下载链接（保持原始链接，切勿在此处转义）
                const magnetRaw = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLinkRaw = item.find('a[title="Download .torrent"]').attr('href') || '';
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 5. 提取封面图
                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 6. 截图处理
                const screenshots = [];
                item.find('.images-description ul li a.img-items').each((_, el) => {
                    const $a = $(el);
                    const originalScreenshotUrl = $a.text().trim().replace(/\s+/g, '');
                    
                    if (originalScreenshotUrl.startsWith('https') && originalScreenshotUrl.endsWith('_s.jpg')) {
                        try {
                            const urlObj = new URL(originalScreenshotUrl);
                            const imgHostDomain = urlObj.hostname;
                            let fullFileName = originalScreenshotUrl.split('/').pop();
                            fullFileName = fullFileName.replace(/^[A-Za-z0-9]+-/, ''); // 剥离随机前缀
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

                // 7. 构造Enclosure（关键修复部分）
                let enclosure = null;
                // 优先使用磁力链接，其次种子文件
                const downloadUrl = magnetRaw || torrentLinkRaw;
                if (downloadUrl) {
                    enclosure = {
                        // *** 修复点：直接使用原始链接，RSSHub在生成XML时会处理必要的转义 ***
                        url: downloadUrl,
                        // *** 修复点：统一使用标准类型，与141PPV示例一致 ***
                        type: 'application/x-bittorrent',
                        // 转换为字节数（示例逻辑，可按需调整）
                        length: (size.match(/\d+(\.\d+)?/)?.[0] || 0) * 1024 * 1024 * 1024, // 假设为GB，简化处理
                    };
                }

                // 8. 返回Item（最终格式）
                return {
                    // 标题包含ID和大小，更清晰
                    title: `${videoId} ${size}`,
                    // *** 修复点：确保pubDate永远有效，避免"Invalid Date" ***
                    pubDate: pubDate ? parseDate(pubDate, 'YYYY-MM-DD') : new Date(),
                    link: itemLink,
                    // 生成稳定的guid
                    guid: `${itemLink}#${videoId}`,
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        coverImage: coverImageUrl,
                        videoId,
                        size,
                        // 模板中可使用原始日期字符串
                        pubDateStr: pubDate || '未知日期',
                        tags,
                        // 传递给模板的也是原始链接
                        magnetRaw: magnetRaw,
                        torrentLink: torrentLinkRaw,
                        screenshots,
                    }),
                    category: tags.length > 0 ? tags : [type],
                    // 仅返回enclosure对象，RSSHub会将其转为<enclosure>标签
                    enclosure: enclosure,
                    // *** 注意：不再需要enclosure_type和enclosure_url字段 ***
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
        // 错误处理
        return {
            title: 'JavBee 订阅抓取失败',
            link: currentUrl || rootUrl,
            description: `错误原因：${error.message}`,
            item: [],
        };
    }
}