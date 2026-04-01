const TEXT_ELEMENT = "TEXT_ELEMENT";

function createTextElement(text) {
  return {
    type: TEXT_ELEMENT,
    props: {
      nodeValue: String(text),
      children: [],
    },
  };
}

function h(type, props, ...children) {
  const flatChildren = children.flat().filter((child) => child !== null && child !== undefined && child !== false);

  return {
    type,
    props: {
      ...(props || {}),
      children: flatChildren.map((child) => (typeof child === "object" ? child : createTextElement(child))),
    },
  };
}

function createDomNode(vNode) {
  if (vNode.type === TEXT_ELEMENT) {
    return document.createTextNode(vNode.props.nodeValue);
  }

  const element = document.createElement(vNode.type);
  updateProps(element, {}, vNode.props);

  vNode.props.children.forEach((child) => {
    element.appendChild(createDomNode(child));
  });

  return element;
}

function isEventProp(name) {
  return name.startsWith("on");
}

function setProp(element, name, value) {
  if (name === "children") {
    return;
  }

  if (name === "className") {
    element.setAttribute("class", value);
    return;
  }

  if (isEventProp(name)) {
    const eventType = name.slice(2).toLowerCase();
    element.addEventListener(eventType, value);
    return;
  }

  if (name in element) {
    element[name] = value;
  } else {
    element.setAttribute(name, value);
  }
}

function removeProp(element, name, value) {
  if (name === "children") {
    return;
  }

  if (name === "className") {
    element.removeAttribute("class");
    return;
  }

  if (isEventProp(name)) {
    const eventType = name.slice(2).toLowerCase();
    element.removeEventListener(eventType, value);
    return;
  }

  if (name in element) {
    element[name] = "";
  } else {
    element.removeAttribute(name);
  }
}

function updateProps(element, oldProps, newProps) {
  Object.keys(oldProps).forEach((name) => {
    if (!(name in newProps)) {
      removeProp(element, name, oldProps[name]);
    }
  });

  Object.keys(newProps).forEach((name) => {
    if (oldProps[name] !== newProps[name]) {
      if (name in oldProps) {
        removeProp(element, name, oldProps[name]);
      }
      setProp(element, name, newProps[name]);
    }
  });
}

function patch(parent, newVNode, oldVNode, index = 0) {
  if (!oldVNode) {
    parent.appendChild(createDomNode(newVNode));
    return;
  }

  const target = parent.childNodes[index];

  if (!newVNode) {
    parent.removeChild(target);
    return;
  }

  if (newVNode.type !== oldVNode.type) {
    parent.replaceChild(createDomNode(newVNode), target);
    return;
  }

  if (newVNode.type === TEXT_ELEMENT) {
    if (newVNode.props.nodeValue !== oldVNode.props.nodeValue) {
      target.textContent = newVNode.props.nodeValue;
    }
    return;
  }

  updateProps(target, oldVNode.props, newVNode.props);

  const newChildren = newVNode.props.children;
  const oldChildren = oldVNode.props.children;
  const maxLength = Math.max(newChildren.length, oldChildren.length);

  for (let i = 0; i < maxLength; i += 1) {
    patch(target, newChildren[i], oldChildren[i], i);
  }
}

function hasChangedDeps(oldDeps, newDeps) {
  if (newDeps === undefined) {
    return true;
  }

  if (!oldDeps) {
    return true;
  }

  if (oldDeps.length !== newDeps.length) {
    return true;
  }

  return newDeps.some((dep, index) => !Object.is(dep, oldDeps[index]));
}

let currentComponent = null;

class FunctionComponent {
  constructor(renderFunction, props, rootElement) {
    this.renderFunction = renderFunction;
    this.props = props;
    this.rootElement = rootElement;
    this.hooks = [];
    this.hookIndex = 0;
    this.pendingEffects = [];
    this.virtualDom = null;
  }

  createVirtualDom() {
    currentComponent = this;
    this.hookIndex = 0;
    this.pendingEffects = [];
    const result = this.renderFunction(this.props);
    currentComponent = null;
    return result;
  }

  mount() {
    this.virtualDom = this.createVirtualDom();
    this.rootElement.innerHTML = "";
    this.rootElement.appendChild(createDomNode(this.virtualDom));
    this.runEffects();
  }

  update() {
    const oldVirtualDom = this.virtualDom;
    const newVirtualDom = this.createVirtualDom();
    patch(this.rootElement, newVirtualDom, oldVirtualDom, 0);
    this.virtualDom = newVirtualDom;
    this.runEffects();
  }

  runEffects() {
    this.pendingEffects.forEach((effectJob) => effectJob());
    this.pendingEffects = [];
  }
}

function useState(initialValue) {
  if (!currentComponent) {
    throw new Error("useState는 FunctionComponent 안에서만 사용할 수 있습니다.");
  }

  const component = currentComponent;
  const index = component.hookIndex;

  if (!component.hooks[index]) {
    component.hooks[index] = {
      state: typeof initialValue === "function" ? initialValue() : initialValue,
      setState(nextValue) {
        const currentValue = component.hooks[index].state;
        const valueToStore = typeof nextValue === "function" ? nextValue(currentValue) : nextValue;

        if (Object.is(currentValue, valueToStore)) {
          return;
        }

        component.hooks[index].state = valueToStore;
        component.update();
      },
    };
  }

  const hook = component.hooks[index];
  component.hookIndex += 1;
  return [hook.state, hook.setState];
}

function useEffect(effect, deps) {
  if (!currentComponent) {
    throw new Error("useEffect는 FunctionComponent 안에서만 사용할 수 있습니다.");
  }

  const component = currentComponent;
  const index = component.hookIndex;
  const oldHook = component.hooks[index];
  const shouldRun = hasChangedDeps(oldHook && oldHook.deps, deps);

  if (!oldHook) {
    component.hooks[index] = {
      deps,
      cleanup: null,
    };
  }

  if (shouldRun) {
    component.pendingEffects.push(() => {
      const hook = component.hooks[index];

      if (typeof hook.cleanup === "function") {
        hook.cleanup();
      }

      hook.cleanup = effect() || null;
      hook.deps = deps;
    });
  }

  component.hookIndex += 1;
}

function useMemo(factory, deps) {
  if (!currentComponent) {
    throw new Error("useMemo는 FunctionComponent 안에서만 사용할 수 있습니다.");
  }

  const component = currentComponent;
  const index = component.hookIndex;
  const oldHook = component.hooks[index];

  if (!oldHook || hasChangedDeps(oldHook.deps, deps)) {
    component.hooks[index] = {
      value: factory(),
      deps,
    };
  }

  const hook = component.hooks[index];
  component.hookIndex += 1;
  return hook.value;
}

const BUTTONS = [
  { label: "C", value: "clear", variant: "secondary" },
  { label: "DEL", value: "delete", variant: "secondary" },
  { label: "÷", value: "/", variant: "operator" },
  { label: "×", value: "*", variant: "operator" },
  { label: "7", value: "7" },
  { label: "8", value: "8" },
  { label: "9", value: "9" },
  { label: "-", value: "-", variant: "operator" },
  { label: "4", value: "4" },
  { label: "5", value: "5" },
  { label: "6", value: "6" },
  { label: "+", value: "+", variant: "operator" },
  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "=", value: "equals", variant: "operator" },
  { label: "0", value: "0", wide: true },
  { label: ".", value: "." },
];

function isOperator(value) {
  return ["+", "-", "*", "/"].includes(value);
}

function getCurrentNumber(expression) {
  const parts = expression.split(/[+\-*/]/);
  return parts[parts.length - 1];
}

function evaluateExpression(expression) {
  if (!/^[0-9+\-*/. ]+$/.test(expression)) {
    throw new Error("지원하지 않는 식입니다.");
  }

  const result = new Function(`return ${expression}`)();

  if (!Number.isFinite(result)) {
    throw new Error("계산할 수 없습니다.");
  }

  return result;
}

function formatResult(value) {
  return String(Math.round((value + Number.EPSILON) * 1000000000) / 1000000000);
}

function Display(props) {
  return h(
    "section",
    { className: "display-panel" },
    h("div", { className: "preview" }, props.preview ? `= ${props.preview}` : " "),
    h("div", { className: "display" }, props.display)
  );
}

function CalcButton(props) {
  const className = ["calc-button", props.variant || "", props.wide ? "wide" : ""].filter(Boolean).join(" ");

  return h(
    "button",
    {
      className,
      onClick: () => props.onPress(props.value),
      type: "button",
    },
    props.label
  );
}

function ButtonGrid(props) {
  return h(
    "div",
    { className: "button-grid" },
    props.buttons.map((button) =>
      CalcButton({
        ...button,
        onPress: props.onPress,
      })
    )
  );
}

function App() {
  const [display, setDisplay] = useState("0");
  const [justEvaluated, setJustEvaluated] = useState(false);

  useEffect(() => {
    document.title = `계산기 | ${display}`;
  }, [display]);

  const preview = useMemo(() => {
    if (display === "Error" || justEvaluated) {
      return "";
    }

    if (!/[+\-*/]/.test(display) || isOperator(display[display.length - 1])) {
      return "";
    }

    try {
      return formatResult(evaluateExpression(display));
    } catch (error) {
      return "";
    }
  }, [display, justEvaluated]);

  function handleButtonPress(value) {
    if (value === "clear") {
      setDisplay("0");
      setJustEvaluated(false);
      return;
    }

    if (value === "delete") {
      if (display === "Error" || justEvaluated) {
        setDisplay("0");
        setJustEvaluated(false);
        return;
      }

      const nextDisplay = display.length > 1 ? display.slice(0, -1) : "0";
      setDisplay(nextDisplay);
      return;
    }

    if (value === "equals") {
      try {
        const result = formatResult(evaluateExpression(display));
        setDisplay(result);
        setJustEvaluated(true);
      } catch (error) {
        setDisplay("Error");
        setJustEvaluated(true);
      }
      return;
    }

    if (display === "Error") {
      if (isOperator(value)) {
        return;
      }

      const nextValue = value === "." ? "0." : value;
      setDisplay(nextValue);
      setJustEvaluated(false);
      return;
    }

    if (isOperator(value)) {
      if (isOperator(display[display.length - 1])) {
        setDisplay(display.slice(0, -1) + value);
      } else {
        setDisplay(display + value);
      }
      setJustEvaluated(false);
      return;
    }

    if (value === ".") {
      if (justEvaluated) {
        setDisplay("0.");
        setJustEvaluated(false);
        return;
      }

      const currentNumber = getCurrentNumber(display);
      if (currentNumber.includes(".")) {
        return;
      }

      if (isOperator(display[display.length - 1])) {
        setDisplay(display + "0.");
      } else {
        setDisplay(display + ".");
      }
      return;
    }

    if (justEvaluated) {
      setDisplay(value);
      setJustEvaluated(false);
      return;
    }

    if (display === "0") {
      setDisplay(value);
      return;
    }

    setDisplay(display + value);
  }

  return h(
    "main",
    { className: "calculator" },
    h(
      "header",
      { className: "calculator-header" },
      h("p", { className: "eyebrow" }, "Week 5 Mini React"),
      h("h1", { className: "title" }, "Calculator"),
      h("p", { className: "description" }, "상태는 App 하나가 관리하고, 버튼과 화면은 props만 사용하는 계산기입니다.")
    ),
    Display({ display, preview }),
    ButtonGrid({ buttons: BUTTONS, onPress: handleButtonPress })
  );
}

const rootElement = document.getElementById("app");
const app = new FunctionComponent(App, {}, rootElement);
app.mount();
