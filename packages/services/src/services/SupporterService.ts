import { inject, injectable } from 'inversify';
import { Db, ObjectId } from 'mongodb';
import { z } from 'zod';

const supporterSchema = z.object({
  patron: z.boolean().optional(),
  webhook: z.boolean().optional(),
  maxGuilds: z.number().optional(),
  maxFeeds: z.number().optional(),
  guilds: z.array(z.string()).default([]),
  expireAt: z.date().optional(),
  comment: z.string().optional(),
  slowRate: z.boolean().optional(),
});

export type Supporter = z.input<typeof supporterSchema>;
export type SupporterOutput = z.output<typeof supporterSchema> & {
  _id: ObjectId
};

@injectable()
export default class SupporterService {
  constructor(
    @inject('MongoDB') private readonly db: Db,
  ) {}

  static COLLECTION_NAME = 'supporters';

  async findByDiscordId(discordId: string): Promise<SupporterOutput | null> {
    return this.getCollection().findOne({ 
      _id: discordId as any,
      $or: [
        { expireAt: { $exists: false } },
        // Use Date.now to more easily mock the date in tests
        { expireAt: { $gt: new Date(Date.now()) } },
      ],
    }) as Promise<SupporterOutput | null>;
  }
  
  async findWithGuild(guildId: string) {
    const supporters = await this.getCollection().find({
      guilds: guildId,
      $or: [
        { expireAt: { $exists: false } },
        // Use Date.now to more easily mock the date in tests
        { expireAt: { $gt: new Date(Date.now()) } },
      ],
    }).toArray();
  
    return supporters as SupporterOutput[];
  }

  async addGuildToSupporter(supporterId: string, guildId: string): Promise<void> {
    const supporter = await this.getCollection()
      .findOne({ _id: supporterId as any }) as SupporterOutput;

    if (!supporter) {
      throw new Error(`Supporter ${supporterId} not found`);
    }

    if (!supporter.guilds.includes(guildId)) {
      supporter.guilds.push(guildId);
      await this.getCollection().updateOne({
        _id: supporterId as any,
      }, {
        $set: {
          guilds: supporter.guilds,
        },
      });
    }
  }

  async removeGuildFromSupporter(supporterId: string, guildId: string): Promise<void> {
    const supporter = await this.getCollection()
      .findOne({ _id: supporterId as any }) as SupporterOutput;

    if (!supporter) {
      throw new Error(`Supporter ${supporterId} not found`);
    }

    if (supporter.guilds.includes(guildId)) {
      await this.getCollection().updateOne({
        _id: supporterId as any,
      }, {
        $pull: {
          guilds: guildId,
        },
      });
    }
  }
  
  private getCollection() {
    return this.db.collection(SupporterService.COLLECTION_NAME);
  }
}