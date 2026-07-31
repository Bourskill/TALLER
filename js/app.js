import { loadAll } from "./core/store.js";
import { render } from "./core/dom.js"; // también registra el listener de "app:render"

loadAll().then(render);
