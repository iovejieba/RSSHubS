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
    name: 'JavBee 通用订阅',
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

### 注意事项
1. 若出现超时，可能是站点反爬，建议配置代理；
2. 截图直链自动剥离随机前缀，加载失败会自动降级。`,
    features: {
        nsfw: true,
    },
};

// 代理配置（用户可根据需要修改，无需代理则留空）
const proxyConfig = {
    // 示例：http代理 → proxy: 'http://127.0.0.1:7890'
    // 示例：socks代理 → proxy: 'socks://127.0.0.1:7890'
    proxy: '', // 此处填写你的代理地址，无需代理则保持空字符串
};

async function handler(ctx) {
    let currentUrl;
    const rootUrl = 'https://javbee.vip';
    const timeout = 15000; // 延长超时时间到15秒
    const maxRetries = 1; // 超时后重试1次

    try {
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('keyword') ?? '';

        // 构造请求URL
        if (type === 'popular' && keyword) {
            currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
        } else {
            currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
        }

        // 反爬：添加2-4秒随机延迟（比之前更长，降低拦截概率）
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 2000));

        // 配置请求选项（含重试、代理、强化头）
        const requestOptions = {
            method: 'get',
            url: currentUrl,
            headers: {
                'Referer': rootUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-User': '?1',
            },
            timeout,
            retry: { limit: maxRetries }, // 超时自动重试
            ...(proxyConfig.proxy && { agent: { https: proxyConfig.proxy } }), // 配置代理
        };

        // 发起请求
        const response = await got(requestOptions);
        const $ = load(response.data);

        // 抓取列表项（优化选择器，适配可能的结构变更）
        const items = $('.card .columns, .content .columns')
            .toArray()
            .filter(item => $(item).find('.title.is-4.is-spaced a').length > 0) // 只保留有标题的有效条目
            .map((item) => {
                item = $(item);

                // 提取基础信息
                const titleEl = item.find('.title.is-4.is-spaced a');
                const videoId = titleEl.text().trim() || '未知ID';
                const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
                
                // 提取发布日期
                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink && dateLink.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = extractedDate;
                    }
                }

                // 提取标签
                const tags = item
                    .find('.tags .tag')
                    .toArray()
                    .map((t) => $(t).text().trim())
                    .filter(tag => tag);

                // 提取下载链接
                const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
                const torrentLink = item.find('a[title="Download .torrent"]').attr('href') || '';
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 提取封面图（懒加载data-src）
                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const coverImageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 剥离随机前缀+拼接直链
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
                                alt: `截图${screenshots.length + 1}`
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

                return {
                    title: `${videoId} ${size}`,
                    pubDate: parseDate(pubDate, 'YYYY-MM-DD'),
                    link: itemLink,
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        coverImage: coverImageUrl,
                        videoId,
                        size,
                        pubDate: pubDate || '未知日期',
                        tags,
                        magnet,
                        torrentLink,
                        screenshots,
                    }),
                    category: tags.length > 0 ? tags : [type],
                    enclosure_type: 'application/x-bittorrent',
                    enclosure_url: torrentLink,
                };
            });

        // 生成Feed标题
        const pageTitle = $('title').text().trim();
        const feedTitlePrefix = pageTitle.split('-')[0]?.trim() || type;
        const feedTitle = `JavBee - ${feedTitlePrefix} 资源订阅`;

        // 容错：无有效条目时返回提示
        if (items.length === 0) {
            return {
                title: feedTitle,
                link: currentUrl,
                description: '未抓取到有效资源（可能是页面结构变更或无对应内容）',
                item: [{
                    title: '暂无可用资源',
                    link: currentUrl,
                    description: '请确认站点是否正常访问，或尝试其他类型（如 /javbee/popular/30）',
                    pubDate: new Date(),
                    category: [type],
                }],
            };
        }

        return {
            title: feedTitle,
            link: currentUrl,
            item: items,
        };

    } catch (error) {
        // 区分超时错误和其他错误
        const isTimeout = error.name === 'TimeoutError' || error.message.includes('timeout');
        const errorMsg = isTimeout 
            ? '请求超时（大概率是站点反爬拦截，建议配置代理或稍后重试）'
            : `抓取失败：${error.message}`;

        ctx.status = isTimeout ? 504 : 500;
        return {
            title: 'JavBee 订阅请求失败',
            link: currentUrl || rootUrl,
            description: errorMsg,
            item: [{
                title: isTimeout ? '请求超时' : '抓取失败',
                link: currentUrl || rootUrl,
                description: `错误详情：${error.message}\n解决方案：${isTimeout ? '1. 配置代理 2. 稍后重试 3. 检查网络' : '1. 确认站点可访问 2. 检查选择器是否有效'}`,
                pubDate: new Date(),
            }],
        };
    }
}