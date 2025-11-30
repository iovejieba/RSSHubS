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
    name: '通用',
    maintainers: ['cgkings', 'nczitzk'],
    parameters: { 
        type: '类型，可查看下表的类型说明', 
        keyword: '关键词，可查看下表的关键词说明' 
    },
    handler,
    description: `**类型**

| 最新 | 热门    | 随机   | 指定标签 | 日期 |
| ---- | ------- | ------ | -------- | ---- |
| new  | popular | random | tag      | date |

**关键词**

| 空 | 日期范围    | 标签名         | 年月日     |
| -- | ----------- | -------------- | ---------- |
|    | 7 / 30 / 60 | Adult%20Awards | 2025-11-30 |

**示例说明**

-  \`/javbee/new\`

      仅当类型为 \`new\` \`popular\` 或 \`random\` 时关键词为 **空**

-  \`/javbee/popular/30\`

      \`popular\` 类型的关键词可填写 \`7\` \`30\` 或 \`60\` 三个 **日期范围** 之一，分别对应 **7 天**、**30 天** 或 **60 天内**

-  \`/javbee/tag/Adult%20Awards\`

      \`tag\` 类型的关键词必须填写 **标签名** 且标签中的 \`/\` 必须替换为 \`%2F\` ，可在 [此处](https://javbee.vip/tag/) 标签单页链接中获取

-  \`/javbee/date/2025-11-30\`

      \`date\` 类型的关键词必须填写 **日期(年-月-日)**`,
    features: {
        nsfw: true,
    },
};

async function handler(ctx) {
    let currentUrl;
    const rootUrl = 'https://javbee.vip';
    
    try {
        const type = ctx.req.param('type');
        const keyword = ctx.req.param('keyword') ?? '';

        if (type === 'popular' && keyword) {
            currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
        } else {
            currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
        }

        const response = await got({
            method: 'get',
            url: currentUrl,
            headers: {
                'Referer': rootUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
        });

        const $ = load(response.data);

        const items = $('.card .columns')
            .toArray()
            .map((item) => {
                item = $(item);

                // 提取基础信息
                const titleEl = item.find('.title.is-4.is-spaced a');
                const videoId = titleEl.text().trim() || '未知ID';
                const size = item.find('.title.is-4.is-spaced span.is-size-6').text().trim() || '未知大小';
                
                // 提取日期
                let pubDate;
                const dateLink = item.find('.subtitle a').attr('href');
                if (dateLink && dateLink.includes('/date/')) {
                    const extractedDate = dateLink.split('/date/').pop();
                    if (/^\d{4}-\d{2}-\d{2}$/.test(extractedDate)) {
                        pubDate = extractedDate;
                    }
                }

                // 提取描述（页面中无直接的.description文本，可提取标题补充）
                const descriptionText = videoId || '无描述';
                
                // 提取标签（页面中部分条目无标签）
                const tags = item
                    .find('.tags .tag')
                    .toArray()
                    .map((t) => $(t).text().trim())
                    .filter(tag => tag);

                // 修正：磁力链接选择器（匹配title="Download Magnet"）
                const magnet = item.find('a[title="Download Magnet"]').attr('href') || '';
                
                // Torrent链接选择器（确认匹配）
                const torrentLink = item.find('a[title="Download .torrent"]').attr('href') || '';
                
                // 条目详情链接
                const itemLink = titleEl.attr('href') ? new URL(titleEl.attr('href'), rootUrl).href : currentUrl;

                // 封面图（懒加载data-src）
                const imageEl = item.find('img.image.lazy');
                const imageSrc = imageEl.attr('data-src') || imageEl.attr('src') || '';
                const imageUrl = imageSrc ? new URL(imageSrc, rootUrl).href : '';

                // 修正：截图链接提取（遍历所有li下的.img-items）
                const screenshots = item.find('.images-description ul li .img-items')
                    .toArray()
                    .map((img) => $(img).text().trim().replace(/\s+/g, '')) // 去除多余空格
                    .filter(url => url.startsWith('http') && url.includes('.jpg')); // 过滤有效截图链接

                return {
                    title: `${videoId} ${size}`,
                    pubDate: parseDate(pubDate, 'YYYY-MM-DD'),
                    link: itemLink,
                    description: art(path.join(__dirname, 'templates/description.art'), {
                        image: imageUrl,
                        id: videoId,
                        size,
                        pubDate: pubDate || '未知日期',
                        description: descriptionText,
                        tags,
                        magnet, // 确保传递磁力链接
                        torrentLink, // 明确命名torrent链接
                        screenshots,
                    }),
                    category: tags.length > 0 ? tags : [type],
                    enclosure_type: 'application/x-bittorrent',
                    enclosure_url: torrentLink,
                };
            });

        const pageTitle = $('title').text().trim();
        const titlePrefix = pageTitle.split('-')[0]?.trim() || type;
        const feedTitle = `JavBee - ${titlePrefix}`;

        return {
            title: feedTitle,
            link: currentUrl,
            item: items,
        };

    } catch (error) {
        ctx.status = 500;
        return {
            title: 'JavBee - 抓取失败',
            link: currentUrl || rootUrl,
            description: `抓取错误：${error.message}`,
            item: [],
        };
    }
}