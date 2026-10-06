// Every test runs PouchDB in memory: fast, and nothing left on disk.
import PouchDB from 'pouchdb'
import memory from 'pouchdb-adapter-memory'

PouchDB.plugin(memory)
