import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { SupportersService } from "../supporters/supporters.service";
import { FilterQuery } from "mongoose";
import logger from "../../utils/logger";
import {
  UserFeedDisabledCode,
  UserFeedHealthStatus,
} from "../user-feeds/types";
import {
  UserFeed,
  UserFeedDocument,
  UserFeedModel,
} from "../user-feeds/entities";
import { AmqpConnection, RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import { DiscordMediumEvent } from "../../common";
import {
  castDiscordContentForMedium,
  castDiscordEmbedsForMedium,
} from "../../common/utils";
import { MessageBrokerQueue } from "../../common/constants/message-broker-queue.constants";
import { ArticleRejectCode, FeedRejectCode } from "./constants";
import {
  getConnectionDisableCodeByArticleRejectCode,
  getUserFeedDisableCodeByFeedRejectCode,
} from "./utils";
import { UserFeedsService } from "../user-feeds/user-feeds.service";
import { chunk } from "lodash";

interface PublishFeedDeliveryArticlesData {
  timestamp: number;
  data: {
    feed: {
      id: string;
      url: string;
      passingComparisons: string[];
      blockingComparisons: string[];
      formatOptions: {
        dateFormat: string | undefined;
        dateTimezone: string | undefined;
      };
      dateChecks?: {
        oldArticleDateDiffMsThreshold?: number;
      };
    };
    articleDayLimit: number;
    mediums: Array<DiscordMediumEvent>;
  };
}

@Injectable()
export class ScheduleHandlerService {
  defaultRefreshRateSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly supportersService: SupportersService,
    @InjectModel(UserFeed.name) private readonly userFeedModel: UserFeedModel,
    private readonly amqpConnection: AmqpConnection,
    private readonly userFeedsService: UserFeedsService
  ) {
    this.defaultRefreshRateSeconds =
      (this.configService.get<number>(
        "BACKEND_API_DEFAULT_REFRESH_RATE_MINUTES"
      ) as number) * 60;
  }

  @RabbitSubscribe({
    exchange: "",
    queue: MessageBrokerQueue.UrlFailedDisableFeeds,
  })
  async handleUrlRequestFailureEvent({
    data: { url },
  }: {
    data: { url: string };
  }) {
    logger.debug(`handling url request failure event for url ${url}`);

    await this.userFeedModel
      .updateMany(
        {
          url,
          disabledCode: {
            $exists: false,
          },
        },
        {
          $set: {
            disabledCode: UserFeedDisabledCode.FailedRequests,
            healthStatus: UserFeedHealthStatus.Failed,
          },
        }
      )
      .lean();
  }

  @RabbitSubscribe({
    exchange: "",
    queue: MessageBrokerQueue.FeedRejectedDisableFeed,
  })
  async handleFeedRejectedDisableFeed({
    data: {
      feed: { id: feedId },
      rejectedCode,
    },
  }: {
    data: {
      rejectedCode: FeedRejectCode;
      feed: {
        id: string;
      };
    };
  }) {
    const foundFeed = await this.userFeedModel.findById(feedId).lean();

    if (!foundFeed) {
      logger.warn(
        `No feed with ID ${feedId} was found when attempting to` +
          ` handle message from ${MessageBrokerQueue.FeedRejectedDisableFeed}`
      );

      return;
    }

    const disabledCode = getUserFeedDisableCodeByFeedRejectCode(rejectedCode);

    await this.userFeedModel.updateOne(
      {
        _id: feedId,
        disabledCode: {
          $exists: false,
        },
      },
      {
        $set: {
          disabledCode,
        },
      }
    );
  }

  @RabbitSubscribe({
    exchange: "",
    queue: MessageBrokerQueue.FeedRejectedArticleDisableConnection,
  })
  async handleRejectedArticleDisableConnection({
    data: {
      rejectedCode,
      medium: { id: mediumId },
      feed: { id: feedId },
    },
  }: {
    data: {
      rejectedCode: ArticleRejectCode;
      medium: {
        id: string;
      };
      feed: {
        id: string;
      };
    };
  }) {
    const foundFeed = await this.userFeedModel.findById(feedId).lean();

    if (!foundFeed) {
      logger.warn(
        `No feed with ID ${feedId} was found when attempting to` +
          ` handle message from ${MessageBrokerQueue.FeedRejectedArticleDisableConnection}`
      );

      return;
    }

    const connectionEntries = Object.entries(foundFeed.connections) as Array<
      [
        keyof UserFeed["connections"],
        UserFeed["connections"][keyof UserFeed["connections"]]
      ]
    >;

    const disableCode =
      getConnectionDisableCodeByArticleRejectCode(rejectedCode);

    for (const [connectionKey, connections] of connectionEntries) {
      for (let conIdx = 0; conIdx < connections.length; ++conIdx) {
        const connection = connections[conIdx];

        if (connection.id.toHexString() !== mediumId) {
          continue;
        }

        await this.userFeedModel.updateOne(
          {
            _id: feedId,
            [`connections.${connectionKey}.${conIdx}.disabledCode`]: {
              $exists: false,
            },
          },
          {
            $set: {
              [`connections.${connectionKey}.${conIdx}.disabledCode`]:
                disableCode,
            },
          }
        );
      }
    }
  }

  async emitUrlRequestEvent(data: { url: string; rateSeconds: number }) {
    this.amqpConnection.publish<{ data: { url: string; rateSeconds: number } }>(
      "",
      MessageBrokerQueue.UrlFetch,
      { data },
      {
        expiration: data.rateSeconds * 1000,
      }
    );

    logger.debug("successfully emitted url request event");
  }

  async emitUrlRequestBatchEvent(data: {
    rateSeconds: number;
    data: Array<{ url: string }>;
  }) {
    this.amqpConnection.publish<{
      rateSeconds: number;
      timestamp: number;
      data: Array<{ url: string }>;
    }>(
      "",
      MessageBrokerQueue.UrlFetchBatch,
      { ...data, timestamp: Date.now() },
      {
        expiration: data.rateSeconds * 1000,
      }
    );

    logger.debug("successfully emitted url request event");
  }

  emitDeliverFeedArticlesEvent({
    userFeed,
    maxDailyArticles,
  }: {
    userFeed: UserFeed;
    maxDailyArticles: number;
  }) {
    const discordChannelMediums = userFeed.connections.discordChannels
      .filter((c) => !c.disabledCode)
      .map<DiscordMediumEvent>((con) => ({
        id: con.id.toHexString(),
        key: "discord",
        filters: con.filters?.expression
          ? { expression: con.filters.expression }
          : null,
        details: {
          guildId: con.details.channel.guildId,
          channel: {
            id: con.details.channel.id,
            type: con.details.channel.type,
            guildId: con.details.channel.guildId,
          },
          content: castDiscordContentForMedium(con.details.content),
          embeds: castDiscordEmbedsForMedium(con.details.embeds),
          forumThreadTitle: con.details.forumThreadTitle,
          forumThreadTags: con.details.forumThreadTags,
          mentions: con.mentions,
          formatter: {
            formatTables: con.details.formatter?.formatTables,
            stripImages: con.details.formatter?.stripImages,
          },
          splitOptions: con.splitOptions?.isEnabled
            ? con.splitOptions
            : undefined,
          placeholderLimits: con.details.placeholderLimits,
          enablePlaceholderFallback: con.details.enablePlaceholderFallback,
        },
      }));

    const discordWebhookMediums = userFeed.connections.discordWebhooks
      .filter((c) => !c.disabledCode)
      .map<DiscordMediumEvent>((con) => ({
        id: con.id.toHexString(),
        key: "discord",
        filters: con.filters?.expression
          ? { expression: con.filters.expression }
          : null,
        details: {
          guildId: con.details.webhook.guildId,
          webhook: {
            id: con.details.webhook.id,
            token: con.details.webhook.token,
            name: con.details.webhook.name,
            iconUrl: con.details.webhook.iconUrl,
          },
          content: castDiscordContentForMedium(con.details.content),
          embeds: castDiscordEmbedsForMedium(con.details.embeds),
          formatter: {
            formatTables: con.details.formatter?.formatTables,
            stripImages: con.details.formatter?.stripImages,
          },
          splitOptions: con.splitOptions?.isEnabled
            ? con.splitOptions
            : undefined,
          mentions: con.mentions,
          placeholderLimits: con.details.placeholderLimits,
          enablePlaceholderFallback: con.details.enablePlaceholderFallback,
        },
      }));

    const allMediums = discordChannelMediums.concat(discordWebhookMediums);

    this.amqpConnection.publish<PublishFeedDeliveryArticlesData>(
      "",
      MessageBrokerQueue.FeedDeliverArticles,
      {
        timestamp: Date.now(),
        data: {
          articleDayLimit: maxDailyArticles,
          feed: {
            id: userFeed._id.toHexString(),
            url: userFeed.url,
            passingComparisons: userFeed.passingComparisons || [],
            blockingComparisons: userFeed.blockingComparisons || [],
            formatOptions: {
              dateFormat: userFeed.formatOptions?.dateFormat,
              dateTimezone: userFeed.formatOptions?.dateTimezone,
            },
            dateChecks: userFeed.dateCheckOptions,
          },
          mediums: allMediums,
        },
      },
      {
        expiration: 1000 * 60 * 60, // 1 hour
      }
    );

    logger.debug("successfully emitted deliver feed articles event");
  }

  async handleRefreshRate(
    refreshRateSeconds: number,
    {
      urlsHandler,
      feedHandler,
    }: {
      urlsHandler: (data: Array<{ url: string }>) => Promise<void>;
      feedHandler: (
        feed: UserFeed,
        {
          maxDailyArticles,
        }: {
          maxDailyArticles: number;
        }
      ) => Promise<void>;
    }
  ) {
    await this.syncRefreshRates();

    const allBenefits =
      await this.supportersService.getBenefitsOfAllDiscordUsers();

    const dailyLimitsByDiscordUserId = new Map<string, number>(
      allBenefits.map<[string, number]>((benefit) => [
        benefit.discordUserId,
        benefit.maxDailyArticles,
      ])
    );

    const urls = await this.getUrlsMatchingRefreshRate(refreshRateSeconds);

    logger.debug(
      `Found ${urls.length} urls with refresh rate ${refreshRateSeconds}`,
      {
        urls,
      }
    );

    await Promise.all(
      chunk(
        urls.map((url) => ({ url })),
        25
      ).map((urlsChunk) => urlsHandler(urlsChunk))
    );

    const feedCursor = await this.getFeedCursorMatchingRefreshRate(
      refreshRateSeconds
    );

    for await (const feed of feedCursor) {
      const discordUserId = feed.user.discordUserId;
      const maxDailyArticles =
        dailyLimitsByDiscordUserId.get(discordUserId) ||
        this.supportersService.maxDailyArticlesDefault;

      await feedHandler(feed, {
        maxDailyArticles,
      });
    }
  }

  async getUrlsMatchingRefreshRate(
    refreshRateSeconds: number
  ): Promise<string[]> {
    return this.getFeedsQuery(refreshRateSeconds).distinct("url");
  }

  async getFeedCursorMatchingRefreshRate(refreshRateSeconds: number) {
    return this.getFeedsQuery(refreshRateSeconds).cursor();
  }

  async getValidDiscordUserSupporters() {
    const allBenefits =
      await this.supportersService.getBenefitsOfAllDiscordUsers();

    return allBenefits.filter(({ isSupporter }) => isSupporter);
  }

  getFeedsQuery(rate: number) {
    const query: FilterQuery<UserFeedDocument> = {
      $and: [
        {
          refreshRateSeconds: rate,
          disabledCode: {
            $exists: false,
          },
        },
        {
          $or: [
            {
              "connections.discordChannels.0": {
                $exists: true,
              },
              "connections.discordChannels": {
                $elemMatch: {
                  disabledCode: {
                    $exists: false,
                  },
                },
              },
            },
            {
              "connections.discordWebhooks.0": {
                $exists: true,
              },
              "connections.discordWebhooks": {
                $elemMatch: {
                  disabledCode: {
                    $exists: false,
                  },
                },
              },
            },
          ],
        },
      ],
    };

    return this.userFeedModel.find(query);
  }

  async enforceUserFeedLimits() {
    const benefits =
      await this.supportersService.getBenefitsOfAllDiscordUsers();

    await this.userFeedsService.enforceUserFeedLimits(
      benefits.map(({ discordUserId, maxUserFeeds }) => ({
        discordUserId,
        maxUserFeeds,
      }))
    );
  }

  async syncRefreshRates() {
    const benefits =
      await this.supportersService.getBenefitsOfAllDiscordUsers();

    const validSupporters = benefits.filter(({ isSupporter }) => isSupporter);

    const supportersByRefreshRates = new Map<number, string[]>();

    for (const s of validSupporters) {
      const { refreshRateSeconds } = s;

      const currentDiscordUserIds =
        supportersByRefreshRates.get(refreshRateSeconds);

      if (!currentDiscordUserIds) {
        supportersByRefreshRates.set(refreshRateSeconds, [s.discordUserId]);
      } else {
        currentDiscordUserIds.push(s.discordUserId);
      }
    }

    const refreshRates = Array.from(supportersByRefreshRates.entries());

    const specialDiscordUserIds: string[] = [];

    await Promise.all(
      refreshRates.map(async ([refreshRateSeconds, discordUserIds]) => {
        await this.userFeedModel.updateMany(
          {
            "user.discordUserId": {
              $in: discordUserIds,
            },
            refreshRateSeconds: {
              $ne: refreshRateSeconds,
            },
          },
          {
            $set: {
              refreshRateSeconds,
            },
          }
        );

        specialDiscordUserIds.push(...discordUserIds);
      })
    );

    await this.userFeedModel.updateMany(
      {
        "user.discordUserId": {
          $nin: specialDiscordUserIds,
        },
        refreshRateSeconds: {
          $ne: this.defaultRefreshRateSeconds,
        },
      },
      {
        $set: {
          refreshRateSeconds: this.defaultRefreshRateSeconds,
        },
      }
    );
  }
}
