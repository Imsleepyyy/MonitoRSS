import { Collection, Db, Document, ObjectId } from 'mongodb';
import { setupTests, teardownTests } from '../utils/testing';
import FeedRepository, { Feed } from './FeedRepository';

describe('FeedRepository', () => {
  let feedRepo: FeedRepository;
  let db: Db;
  const collectionName = FeedRepository.COLLECTION_NAME;
  let collection: Collection<Document>;

  beforeAll(async () => {
    db = await setupTests();
    collection = db.collection(collectionName);

    feedRepo = FeedRepository.getRepository(db);
  });
  beforeEach(async  () => {
    await db.dropDatabase();
  });
  
  afterAll(async () => {
    await teardownTests();
  });

  describe('insert', () => {
    const toCreate: Feed = {
      channel: 'hello',
      guild: '123',
      title: 'hhh',
      url: 'http://www.google.com',
    } as const;

    it('inserts', async () => {
      await feedRepo.insert({ ...toCreate });

      const result = await collection.find().toArray();
      expect(result.length).toBe(1);
      expect(result[0]).toMatchObject(toCreate);
    });
    it('sets default values for the relevant fields', async () => {
      await feedRepo.insert({ ...toCreate });

      const result = await collection.find().toArray();
      expect(result[0]).toMatchObject({
        filters: {},
        rfilters: {},
        embeds: [],
        ncomparisons: [],
        pcomparisons: [],
        regexOps: {},
      });
    });
    it('throws if there is an invalid type in input', async () => {

      await expect(feedRepo.insert({
        ...toCreate,
        guild: 123,
      } as any))
        .rejects.toThrowError();
    });
  });

  describe('update', () => {
    const toCreate = Object.freeze({
      channel: 'hello',
      guild: '123',
      title: 'hhh',
      url: 'http://www.google.com',
    });
    let insertedId: ObjectId;

    beforeEach(async () => {
      const inserted = await collection.insertOne({ ...toCreate });
      insertedId = inserted.insertedId;
    });

    it('updates', async () => {
      const update = {
        url: 'http://www.newurl.com',
      };

      await feedRepo.update(insertedId, update);

      const result = await collection.findOne({
        _id: insertedId,
      });
      expect(result).toMatchObject({
        ...toCreate,
        ...update,
      });
    });
  });

  describe('findByChannelId', () => {
    it('returns all the feeds in a channel', async () => {
      const channel = '123';
      const feedsToCreate: Feed[] = [{
        channel,
        guild: '123',
        title: 'hhh',
        url: 'http://www.google1.com',
      }, {
        channel,
        guild: '123',
        title: 'hhh',
        url: 'http://www.google2.com',
      }, {
        channel: channel + 'diff',
        guild: '123',
        title: 'hhh',
        url: 'http://www.google3.com',
      }];

      await collection.insertMany(feedsToCreate);

      const result = await feedRepo.findByField('channel', channel);
      expect(result).toHaveLength(2);
      const urls = result.map(r => r.url);
      expect(urls).toEqual(expect.arrayContaining([
        feedsToCreate[0].url,
        feedsToCreate[1].url,
      ]));
    });
  });

  describe('countInGuild', () => {
    it('returns correctly', async () => {
      const guild = '123';
      const feedsToCreate: Feed[] = [{
        channel: '123',
        guild,
        title: 'hhh',
        url: 'http://www.google1.com',
      }, {
        channel: '123',
        guild,
        title: 'hhh',
        url: 'http://www.google2.com',
      }, {
        channel: '123',
        guild: guild + 'new',
        title: 'hhh',
        url: 'http://www.google3.com',
      }];

      await collection.insertMany(feedsToCreate);

      const result = await feedRepo.countInGuild(guild);
      expect(result).toBe(2);
    });
  });
});