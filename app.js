var appy = require('appy');
var async = require('async');
var uploadfs = require('uploadfs')();
var fs = require('fs');
var apos = require('apostrophe')();
var _ = require('underscore');
var extend = require('extend');
var app, db;
var demo;
var pages;
var snippets;
var blog;
var events;
var map;
var people;
var groups;
var sections;

// Server-specific settings to be merged with options
// See local.example.js
var local = require('./data/local.js');

local.db = local.db || {};

var options = {
  // Don't bother with viewEngine, we'll use apos.partial() if we want to
  // render anything directly

  auth: {
    strategy: 'local',
    options: {
      users: {
        admin: {
          type: 'person',
          username: 'admin',
          password: 'demo',
          _id: 'admin',
          // Without this login is forbidden
          login: true,
          permissions: [ 'admin' ]
        }
      },
      // A user is just a snippet page with username and password properties.
      // (Yes, the password property is hashed and salted.)
      collection: 'aposPages',
      template: function(data) {
        return pages.decoratePageContent({ content: apos.partial('login', data) });
      }
    }
  },

  // Make sure we check the .login flag so people who have profiles but no
  // login privileges are not allowed to log in
  beforeSignin: function(user, callback) {
    if (user.type !== 'person') {
      // Whaaat the dickens this page is not even a person
      return callback('error');
    }
    if (!user.login) {
      return callback({ message: 'user does not have login privileges' });
    } else {
      return callback(null);
    }
  },

  sessionSecret: 'whatever',

  db: {
    // 127.0.0.1 connects much faster than localhost when offline on macs,
    // goes to the same place
    host: local.db.host || '127.0.0.1',
    port: local.db.port || 27017,
    name: local.db.name || 'apostrophe-sandbox',
    collections: [
      // Handy way to get appy to create mongodb collection objects for you,
      // see the appy docs
    ]
  },

  // Supplies LESS middleware by default
  static: __dirname + '/public',

  // Where uploaded images go. This can be s3 or any other backend thanks to uploadfs.
  // Note you can't use the local backend with Heroku (Heroku does not have a persistent
  // writable filesystem)
  uploadfs: {
    backend: 'local',
    uploadsPath: __dirname + '/public/uploads',
    uploadsUrl: local.uploadsUrl,
    tempPath: __dirname + '/data/temp/uploadfs',
    // Register Apostrophe's standard image sizes. Notice you could
    // concatenate your own list of sizes if you had a need to
    imageSizes: apos.defaultImageSizes.concat([])
  },

  ready: function(appArg, dbArg)
  {
    app = appArg;
    db = dbArg;

    async.series([ createTemp, initUploadfs, initApos, setRoutes ], listen);
  }
};

// Allow Express locals to come from the options object above or
// from data/local.js

var locals = options.locals || {};
extend(true, locals, local.locals || {});

var demo = locals.demo;
appy.bootstrap(options);

function createTemp(callback) {
  if (!fs.existsSync(__dirname + '/data/temp')) {
    fs.mkdir(__dirname + '/data/temp', callback);
  } else {
    callback(null);
  }
}

function initUploadfs(callback) {
  uploadfs.init(options.uploadfs, callback);
}

function initApos(callback) {
  require('apostrophe-twitter')({ apos: apos, app: app });
  require('apostrophe-rss')({ apos: apos, app: app });
  require('apostrophe-raptor')({ apos: apos, app: app });

  async.series([initAposMain, initAposPages, initAposSnippets, initAposBlog, initAposEvents, initAposMap, initAposPeople, initAposGroups,initAposSections, initAposPageTypesMenu, initAposAppAssets], callback);

  function initAposMain(callback) {
    return apos.init({
      db: db,
      app: app,
      uploadfs: uploadfs,
      permissions: aposPermissions,
      locals: local.locals,
      // Allows us to extend shared layouts
      partialPaths: [ __dirname + '/views/global' ],
      minify: local.minify
    }, callback);
  }

  function initAposPages(callback) {
    var pageTypes = [
      { name: 'default', label: 'Default (Two Column)' },
      { name: 'onecolumn', label: 'One Column' },
      { name: 'home', label: 'Home Page' },
      { name: 'largeSlideshow', label: 'Large Slideshow' }
    ];
    // This feature isn't styled adequately for the demo site yet
    if (!demo) {
      pageTypes.push({ name: 'sectioned', label: 'Page With Sections' });
    }
    pages = require('apostrophe-pages')({ apos: apos, app: app, types: pageTypes }, callback);
  }

  function initAposSnippets(callback) {
    snippets = require('apostrophe-snippets')({ apos: apos, pages: pages, app: app }, callback);
  }

  function initAposBlog(callback) {
    blog = require('apostrophe-blog')({ apos: apos, pages: pages, app: app }, callback);
  }

  function initAposEvents(callback) {
    // This feature hasn't been styled adequately for
    // the official demo site yet
    if (demo) {
      return callback(null);
    }
    events = require('apostrophe-events')({ apos: apos, pages: pages, app: app }, callback);
  }

  // We could subclass the blog module in lib/modules/blog/index.js so that we can supply alternative templates.
  // function initAposBlog(callback) {
  //   blog = require('./lib/modules/blog/index.js')({
  //     apos: apos,
  //     pages: pages,
  //     app: app,
  //     widget: true,
  //     browser: {
  //       construct: 'MyBlog'
  //     }
  //   }, callback);
  // }

  function initAposMap(callback) {
    map = require('apostrophe-map')({ apos: apos, pages: pages, app: app }, callback);
    // Start the background geocoder.
    //
    // NOTE: if you are using multiple processes and/or servers,
    // call this from only ONE to avoid exceeding Google's rate limits
    map.startGeocoder();
  }

  function initAposPeople(callback) {
    people = require('apostrophe-people')({
      apos: apos,
      pages: pages,
      app: app,
      widget: true
    }, callback);
  }

  function initAposGroups(callback) {
    if (!demo) {
      groups = require('apostrophe-groups')({
        apos: apos,
        pages: pages,
        app: app,
        people: people,
        widget: true
      }, function(err) {
        people.setGroups(groups);
        return callback(err);
      });
    } else {
      return callback(null);
    }
  }

  function initAposSections(callback) {
    sections = require('apostrophe-sections')({ apos: apos, app: app }, callback);
  }

  // Now that all of the types are set up, we can change our minds
  // about which ones are actually on the dropdown for making a new
  // page, or change the order. In this case we get rid of
  // "Snippets" as a page type, because they are mostly useful as
  // a widget to be inserted in other pages

  function initAposPageTypesMenu(callback) {
    var pageTypesMenu = [
      { name: 'default', label: 'Default (Two Column)' },
      { name: 'onecolumn', label: 'One Column' },
      { name: 'home', label: 'Home Page' },
      { name: 'largeSlideshow', label: 'Large Slideshow' }
    ];
    if (!demo) {
      pageTypesMenu.push({ name: 'sectioned', label: 'Page With Sections' });
    }
    pageTypesMenu = pageTypesMenu.concat([
      { name: 'blog', label: 'Blog' },
      { name: 'map', label: 'Map' }
    ]);
    if (!demo) {
      pageTypesMenu = pageTypesMenu.concat([
        { name: 'groups', label: 'Directory' }
      ]);
    }
    pages.setMenu(pageTypesMenu);
    return callback(null);
  }


  function initAposAppAssets(callback) {
    pushAsset('stylesheet', 'site', { when: 'always' });
    pushAsset('script', 'site', { when: 'always' });
    return callback();
    function pushAsset(type, name, options) {
      options.fs = __dirname;
      options.web = '';
      return apos.pushAsset(type, name, options);
    }
  }
}

function setRoutes(callback) {
  // Other app-specific routes here.

  // LAST ROUTE: pages in the wiki. We want these at the root level.

  // pages.serve does all the work. Just supply callbacks for some things
  // we'd like to do in addition.

  var load = [
    // Shared page with things like the footer
    'global',
    // Modules that introduce their own loaders
    snippets.loader,
    blog.loader,
    map.loader,
    people.loader,
    pages.searchLoader
  ];
  // Add this one if it's enabled
  if (events) {
    load.push(events.loader);
  }
  if (groups) {
    load.push(groups.loader);
  }

  app.get('*', pages.serve({
    templatePath: __dirname + '/views/pages',
    tabOptions: { depth: 2 },
    load: load
  }));

  return callback(null);
}

function listen(err) {
  if (err) {
    throw err;
  }
  // Command line tasks
  if (apos.startTask()) {
    // Chill and let the task run until it's done, don't try to listen or exit
    return;
  }
  appy.listen();
}

// Allow only the admin user to edit anything with Apostrophe,
// let everyone view anything

function aposPermissions(req, action, object, callback) {
  if (req.user && (req.user.username === 'admin')) {
    // OK
    return callback(null);
  } else if (action.match(/^view/)) {
    return callback(null);
  } else {
    return callback('Forbidden');
  }
}
