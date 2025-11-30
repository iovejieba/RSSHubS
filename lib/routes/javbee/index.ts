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
    parameters: { type: '类型，可查看下表的类型说明', keyword: '关键词，可查看下表的关键词说明' },
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
    const rootUrl = 'https://javbee.vip';
    const type = ctx.req.param('type');
    const keyword = ctx.req.param('keyword') ?? '';

    // 处理 popular 类型的特殊 URL 格式
    let currentUrl;
    if (type === 'popular' && keyword) {
        currentUrl = `${rootUrl}/${type}?sort_day=${keyword}`;
    } else {
        currentUrl = `${rootUrl}/${type}${keyword ? `/${keyword}` : ''}`;
    }

    const response = await got({
        method: 'get',
        url: currentUrl,
    });

    const $ = load(response.data);

    if (getSubPath(ctx) === '/') {
        ctx.set('redirect', `/javbee${$('.overview').first().attr('href')}`);
        return;
    }

    const items = $('.columns')
        .toArray()
        .map((item) => {
            item = $(item);

            const id = item.find('.title a').text();
            const size = item.find('.title span').text();
            
            // 尝试从多个位置获取日期
            let pubDate;
            const dateLink = item.find('.subtitle a').attr('href');
            if (dateLink && dateLink.includes('/date/')) {
                pubDate = dateLink.split('/date/').pop();
            }
            
            // 如果没有找到日期，设置为当前日期或null
            if (!pubDate) {
                pubDate = new Date().toISOString().split('T')[0]; // 使用当前日期作为默认值
            }

            const description = item.find('.has-text-grey-dark').text();
            const tags = item
                .find('.tag')
                .toArray()
                .map((t) => $(t).text().trim());
            const magnet = item.find('a[title="Magnet torrent"]').attr('href');
            const link = item.find('a[title="Download .torrent"]').attr('href');
            const image = item.find('.image').attr('src');

            return {
                title: `${id} ${size}`,
                pubDate: parseDate(pubDate, 'YYYY-MM-DD'), // 修改日期格式
                link: new URL(item.find('a').first().attr('href'), rootUrl).href,
                description: art(path.join(__dirname, 'templates/description.art'), {
                    image,
                    id,
                    size,
                    pubDate,
                    description,
                    tags,
                    magnet,
                    link,
                }),
                category: tags,
                enclosure_type: 'application/x-bittorrent',
                enclosure_url: magnet,
            };
        });

    return {
        title: `JavBee - ${$('title').text().split('-')[0].trim()}`,
        link: currentUrl,
        item: items,
    };
}