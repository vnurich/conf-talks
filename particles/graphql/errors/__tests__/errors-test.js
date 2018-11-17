/* @flow strict */

import {
  GraphQLString,
  GraphQLInt,
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLUnionType,
  GraphQLList,
  GraphQLNonNull,
  graphql,
} from 'graphql';

describe('check different Error approaches', () => {
  it('throw error in resolve method', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          search: {
            args: {
              q: { type: GraphQLString },
            },
            resolve: (_, args) => {
              if (!args.q) throw new Error('missing q');
              return { text: args.q };
            },
            type: new GraphQLObjectType({
              name: 'Record',
              fields: {
                text: {
                  type: GraphQLString,
                  resolve: source => source.text,
                },
              },
            }),
          },
        },
      }),
    });

    const res = await graphql({
      schema,
      source: `
        query {
          s1: search(q: "ok") { text }
          s2: search { text }
          s3: search(q: "good") { text }
        }
      `,
    });

    // console.log(JSON.stringify(res));
    expect(res).toEqual({
      errors: [{ message: 'missing q', locations: [{ line: 4, column: 11 }], path: ['s2'] }],
      data: { s1: { text: 'ok' }, s2: null, s3: { text: 'good' } },
    });
  });

  it('throw error with extensions in resolve method', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          search: {
            resolve: () => {
              const e: any = new Error('Some error');
              e.extensions = { a: 1, b: 2 }; // will be passed in GraphQL-response
              e.someOtherData = { c: 3, d: 4 }; // will be omitted
              throw e;
            },
            type: GraphQLString,
          },
        },
      }),
    });

    const res = await graphql({
      schema,
      source: `query { search }`,
    });

    // console.log(JSON.stringify(res));
    expect(res).toEqual({
      errors: [
        {
          message: 'Some error',
          locations: [{ line: 1, column: 9 }],
          path: ['search'],
          extensions: { a: 1, b: 2 },
        },
      ],
      data: { search: null },
    });
  });

  it('errors (PROBLEMS) via Union-type', async () => {
    // Define our models
    class Video {
      title: string;
      url: string;

      constructor({ title, url }) {
        this.title = title;
        this.url = url;
      }
    }

    class VideoInProgressProblem {
      estimatedTime: number;
      constructor({ estimatedTime }) {
        this.estimatedTime = estimatedTime;
      }
    }

    class VideoNeedBuyProblem {
      price: number;
      constructor({ price }) {
        this.price = price;
      }
    }

    class VideoApproveAgeProblem {
      minAge: number;
      constructor({ minAge }) {
        this.minAge = minAge;
      }
    }

    // Define GraphQL types for our models
    const VideoType = new GraphQLObjectType({
      name: 'Video',
      fields: () => ({
        title: { type: GraphQLString },
        url: { type: GraphQLString },
      }),
    });

    const VideoInProgressProblemType = new GraphQLObjectType({
      name: 'VideoInProgressProblem',
      fields: () => ({
        estimatedTime: { type: GraphQLInt },
      }),
    });

    const VideoNeedBuyProblemType = new GraphQLObjectType({
      name: 'VideoNeedBuyProblem',
      fields: () => ({
        price: { type: GraphQLInt },
      }),
    });

    const VideoApproveAgeProblemType = new GraphQLObjectType({
      name: 'VideoApproveAgeProblem',
      fields: () => ({
        minAge: { type: GraphQLInt },
      }),
    });

    // Create our Union type which returns different ObjectTypes
    const VideoResultType = new GraphQLUnionType({
      name: 'VideoResult',
      types: () => [
        VideoType,
        VideoInProgressProblemType,
        VideoNeedBuyProblemType,
        VideoApproveAgeProblemType,
      ],
      resolveType: value => {
        if (value instanceof Video) {
          return VideoType;
        } else if (value instanceof VideoInProgressProblem) {
          return VideoInProgressProblemType;
        } else if (value instanceof VideoNeedBuyProblem) {
          return VideoNeedBuyProblemType;
        } else if (value instanceof VideoApproveAgeProblem) {
          return VideoApproveAgeProblemType;
        }
        return null;
      },
    });

    // Define some working schema with mock data
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          list: {
            type: new GraphQLList(VideoResultType),
            resolve: () => {
              return [
                new Video({ title: 'DOM2 in the HELL', url: 'https://url' }),
                new VideoApproveAgeProblem({ minAge: 21 }),
                new VideoNeedBuyProblem({ price: 10 }),
                new VideoInProgressProblem({ estimatedTime: 220 }),
              ];
            },
          },
        },
      }),
    });

    const res = await graphql({
      schema,
      source: `
        query {
          list {
            __typename # <----- магическое поле, которое вернет имя типа для каждой записи
            ...on Video {
              title
              url
            }
            ...on VideoInProgressProblem {
              estimatedTime
            }
            ...on VideoNeedBuyProblem {
              price
            }
            ...on VideoApproveAgeProblem {
              minAge
            }
          }
        }
      `,
    });
    expect(res).toEqual({
      data: {
        list: [
          { __typename: 'Video', title: 'DOM2 in the HELL', url: 'https://url' },
          { __typename: 'VideoApproveAgeProblem', minAge: 21 },
          { __typename: 'VideoNeedBuyProblem', price: 10 },
          { __typename: 'VideoInProgressProblem', estimatedTime: 220 },
        ],
      },
    });
  });

  it('undefined is not a function', async () => {
    // Define some working schema with mock data
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          wrong: {
            type: GraphQLString,
            resolve: () => {
              // $FlowFixMe
              return undefined();
            },
          },
          correct: {
            type: GraphQLString,
            resolve: () => 'ok',
          },
        },
      }),
    });

    const res = await graphql({
      schema,
      source: `
        query {
          wrong
          correct
        }
      `,
    });

    expect(res).toEqual({
      errors: [
        {
          message: 'undefined is not a function',
          locations: [{ line: 3, column: 11 }],
          path: ['wrong'],
        },
      ],
      data: { wrong: null, correct: 'ok' },
    });
  });

  it('validation query error', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          correct: {
            type: GraphQLString,
            args: {
              q: { type: GraphQLString },
            },
            resolve: () => 'ok',
          },
        },
      }),
    });

    const res = await graphql({
      schema,
      source: `
        query {
          wrong
          correct
        }
      `,
    });

    // console.log(JSON.stringify(res));
    expect(res).toEqual({
      errors: [
        {
          message: 'Cannot query field "wrong" on type "Query".',
          locations: [{ line: 3, column: 11 }],
        },
      ],
    });

    const res2 = await graphql({
      schema,
      source: `
        query ($q: String!) {
          correct(q: $q)
        }
      `,
    });

    // console.log(JSON.stringify(res2));
    expect(res2).toEqual({
      errors: [
        {
          message: 'Variable "$q" of required type "String!" was not provided.',
          locations: [{ line: 2, column: 16 }],
        },
      ],
    });
  });

  it('validation query response', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          ooops: {
            type: new GraphQLList(GraphQLString),
            resolve: () => ['ok', { hey: 'wrong non String value' }],
          },
        },
      }),
    });

    const res = await graphql(
      schema,
      `
        query {
          ooops
        }
      `
    );

    // console.log(JSON.stringify(res));
    expect(res).toEqual({
      errors: [
        {
          message: 'String cannot represent value: { hey: "wrong non String value" }',
          locations: [{ line: 3, column: 11 }],
          path: ['ooops', 1],
        },
      ],
      data: { ooops: ['ok', null] },
    });
  });

  it('validation query response with NonNull', async () => {
    const schema = new GraphQLSchema({
      query: new GraphQLObjectType({
        name: 'Query',
        fields: {
          ooops: {
            type: new GraphQLList(new GraphQLNonNull(GraphQLString)),
            resolve: () => ['ok', { hey: 'wrong non String value' }],
          },
        },
      }),
    });

    const res = await graphql(
      schema,
      `
        query {
          ooops
        }
      `
    );

    // console.log(JSON.stringify(res));
    expect(res).toEqual({
      errors: [
        {
          message: 'String cannot represent value: { hey: "wrong non String value" }',
          locations: [{ line: 3, column: 11 }],
          path: ['ooops', 1],
        },
      ],
      data: { ooops: null },
    });
  });
});
