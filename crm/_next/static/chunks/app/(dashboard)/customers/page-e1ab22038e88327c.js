(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([
  [7345], {
    1039: function(e, t, a) {
      Promise.resolve().then(a.bind(a, 7531))
    },
    7531: function(e, t, a) {
      "use strict";
      a.r(t), a.d(t, {
        default: function() {
          return C
        }
      });
      var s = a(57437),
        n = a(2265),
        l = a(38038),
        c = a(39891),
        r = a(23588),
        o = a(58222),
        i = a(40094),
        d = a(9883),
        m = a(41827),
        u = a(98253),
        p = a(12741),
        h = a(96142),
        x = a(53711),
        g = a(86264),
        v = a(85749),
        y = a(8032),
        b = a(61396),
        j = a.n(b);
      let N = ["Automotive", "Aerospace", "General Engineering", "Oil & Gas", "Medical", "Heavy Machinery", "Electronics", "Defense", "Other"],
        f = ["A - Key Account", "B - Regular", "C - Prospect", "D - Inactive"],
        k = {
          companyName: "",
          contactPerson: "",
          contactNumber: "",
          designation: "",
          email: "",
          location: "",
          address: "",
          lat: "",
          lng: "",
          geoFenceRadius: "200",
          mapsLink: "",
          category: "",
          industryType: "",
          status: "ACTIVE",
          remarks: "",
          machineDetails: ""
        },
        w = ["ACTIVE", "PROSPECT", "INACTIVE", "LOST"];

      function C() {
        var e, t;
        let a = (0, l.NL)(),
          b = (0, y.t)(e => e.user),
          [C, S] = (0, n.useState)(""),
          [A, P] = (0, n.useState)(""),
          [I, L] = (0, n.useState)(!1),
          [_, T] = (0, n.useState)(k),
          [E, Z] = (0, n.useState)(null),
          [q, F] = (0, n.useState)(""),
          [R, D] = (0, n.useState)(!1),
          [O, G] = (0, n.useState)(null),
          {
            data: M,
            isLoading: U
          } = (0, c.a)({
            queryKey: ["customers", C, A],
            queryFn: () => o.v7.list({
              search: C || void 0,
              industry: A || void 0,
              limit: 500
            }),
            staleTime: 3e4
          }),
          V = (null == M ? void 0 : null === (t = M.data) || void 0 === t ? void 0 : null === (e = t.data) || void 0 === e ? void 0 : e.items) || [],
          Q = (null == M ? void 0 : null === (t = M.data) || void 0 === t ? void 0 : null === (e = t.data) || void 0 === e ? void 0 : e.total) || 0,
          z = (0, r.D)({
            mutationFn: e => E ? o.v7.update(E, e) : o.v7.create(e),
            onSuccess: () => {
              a.invalidateQueries({
                queryKey: ["customers"]
              }), K()
            },
            onError: e => {
              var t, a;
              return F((null == e ? void 0 : null === (a = e.response) || void 0 === a ? void 0 : null === (t = a.data) || void 0 === t ? void 0 : t.message) || "Save failed")
            }
          }),
          J = () => {
            T(k), Z(null), F(""), G(null), L(!0), Y()
          },
          B = e => {
            var t, a, s;
            T({
              companyName: e.companyName,
              contactPerson: e.contactPerson,
              contactNumber: e.contactNumber,
              designation: e.designation || "",
              email: e.email || "",
              location: e.location || "",
              address: e.address || "",
              lat: (null === (t = e.lat) || void 0 === t ? void 0 : t.toString()) || "",
              lng: (null === (a = e.lng) || void 0 === a ? void 0 : a.toString()) || "",
              geoFenceRadius: (null === (s = e.geoFenceRadius) || void 0 === s ? void 0 : s.toString()) || "200",
              mapsLink: e.mapsLink || "",
              category: e.category || "",
              industryType: e.industryType || "",
              status: e.status || "ACTIVE",
              remarks: e.remarks || "",
              machineDetails: e.machineDetails || ""
            }), Z(e.id), F(""), G(null), L(!0)
          },
          K = () => {
            L(!1), Z(null)
          },
          H = e => t => T(a => ({
            ...a,
            [e]: t.target.value
          })),
          Y = () => {
            if (!navigator.geolocation) {
              G({
                type: "error",
                msg: "Location is not supported on this device/browser."
              });
              return
            }
            D(!0), G(null), navigator.geolocation.getCurrentPosition(async e => {
              let t = e.coords.latitude,
                a = e.coords.longitude,
                s = Math.round(e.coords.accuracy);
              T(e => ({
                ...e,
                lat: t.toFixed(6),
                lng: a.toFixed(6)
              })), G({
                type: "ok",
                msg: "Location captured (\xb1".concat(s, "m accuracy).")
              });
              try {
                let e = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=".concat(t, "&lon=").concat(a, "&zoom=18&addressdetails=1"));
                if (e.ok) {
                  let s = await e.json(),
                    n = (null == s ? void 0 : s.address) || {},
                    l = n.city || n.town || n.village || n.suburb || n.county || "";
                  T(e => ({
                    ...e,
                    address: e.address || (null == s ? void 0 : s.display_name) || e.address,
                    location: e.location || l,
                    mapsLink: e.mapsLink || "https://www.google.com/maps?q=".concat(t, ",").concat(a)
                  }))
                }
              } catch (e) {}
              D(!1)
            }, e => {
              D(!1), G({
                type: "error",
                msg: 1 === e.code ? "Location permission denied. Please allow location access and try again." : 3 === e.code ? "Timed out getting your location. Try again, ideally outdoors or near a window." : "Could not get your current location."
              })
            }, {
              enableHighAccuracy: !0,
              timeout: 15e3,
              maximumAge: 0
            })
          };
        return (0, s.jsxs)("div", {
          className: "space-y-5",
          children: [(0, s.jsxs)("div", {
            className: "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3",
            children: [(0, s.jsxs)("div", {
              children: [(0, s.jsx)("h1", {
                className: "page-title",
                children: "Customers"
              }), (0, s.jsxs)("p", {
                className: "page-subtitle",
                children: V.length < Q ? [V.length, " of ", Q, " records"] : [Q, " records"]
              })]
            }), (0, s.jsxs)("button", {
              onClick: J,
              className: "btn-primary btn-sm sm:btn",
              children: [(0, s.jsx)(d.Z, {
                className: "w-4 h-4"
              }), " Add customer"]
            })]
          }), (0, s.jsxs)("div", {
            className: "flex flex-col sm:flex-row gap-3",
            children: [(0, s.jsxs)("div", {
              className: "relative flex-1",
              children: [(0, s.jsx)(m.Z, {
                className: "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              }), (0, s.jsx)("input", {
                value: C,
                onChange: e => S(e.target.value),
                placeholder: "Search by company, contact, phone…",
                className: "input pl-9"
              })]
            }), (0, s.jsxs)("select", {
              value: A,
              onChange: e => P(e.target.value),
              className: "input sm:w-48",
              children: [(0, s.jsx)("option", {
                value: "",
                children: "All industries"
              }), N.map(e => (0, s.jsx)("option", {
                children: e
              }, e))]
            })]
          }), (0, s.jsx)("div", {
            className: "card overflow-hidden",
            children: (0, s.jsx)("div", {
              className: "overflow-x-auto",
              children: (0, s.jsxs)("table", {
                className: "w-full text-sm",
                children: [(0, s.jsx)("thead", {
                  className: "bg-slate-50 dark:bg-slate-800/50",
                  children: (0, s.jsx)("tr", {
                    children: ["Company", "Contact", "Phone", "Location", "Category", "Industry", ""].map(e => (0, s.jsx)("th", {
                      className: "table-head text-left px-4 py-3",
                      children: e
                    }, e))
                  })
                }), (0, s.jsx)("tbody", {
                  children: U ? Array.from({
                    length: 6
                  }).map((e, t) => (0, s.jsx)("tr", {
                    className: "border-b border-slate-100 dark:border-slate-700",
                    children: Array.from({
                      length: 7
                    }).map((e, t) => (0, s.jsx)("td", {
                      className: "px-4 py-3",
                      children: (0, s.jsx)("div", {
                        className: "h-4 bg-slate-100 dark:bg-slate-700 rounded animate-pulse w-20"
                      })
                    }, t))
                  }, t)) : V.length ? V.map(e => (0, s.jsxs)("tr", {
                    className: "table-row",
                    children: [(0, s.jsx)("td", {
                      className: "px-4 py-3",
                      children: (0, s.jsx)(j(), {
                        href: "/customers/detail?id=".concat(e.id),
                        className: "font-medium text-primary hover:underline",
                        children: e.companyName
                      })
                    }), (0, s.jsxs)("td", {
                      className: "px-4 py-3 text-muted",
                      children: [(0, s.jsx)("div", {
                        children: e.contactPerson
                      }), e.designation && (0, s.jsx)("div", {
                        className: "text-xs text-slate-400",
                        children: e.designation
                      })]
                    }), (0, s.jsx)("td", {
                      className: "px-4 py-3",
                      children: (0, s.jsxs)("a", {
                        href: "tel:".concat(e.contactNumber),
                        className: "flex items-center gap-1 text-primary hover:underline",
                        children: [(0, s.jsx)(p.Z, {
                          className: "w-3 h-3"
                        }), e.contactNumber]
                      })
                    }), (0, s.jsx)("td", {
                      className: "px-4 py-3 text-muted",
                      children: e.location ? (0, s.jsxs)("div", {
                        className: "flex items-center gap-1",
                        children: [(0, s.jsx)(h.Z, {
                          className: "w-3 h-3 shrink-0"
                        }), (0, s.jsx)("span", {
                          className: "truncate max-w-[120px]",
                          children: e.location
                        }), e.mapsLink && (0, s.jsx)("a", {
                          href: e.mapsLink,
                          target: "_blank",
                          rel: "noreferrer",
                          className: "text-primary hover:text-primary-600",
                          children: (0, s.jsx)(x.Z, {
                            className: "w-3 h-3"
                          })
                        })]
                      }) : "-"
                    }), (0, s.jsx)("td", {
                      className: "px-4 py-3",
                      children: e.category ? (0, s.jsx)("span", {
                        className: "badge badge-blue",
                        children: e.category
                      }) : "-"
                    }), (0, s.jsx)("td", {
                      className: "px-4 py-3 text-muted text-xs",
                      children: e.industryType || "-"
                    }), (0, s.jsx)("td", {
                      className: "px-4 py-3",
                      children: (0, s.jsxs)("div", {
                        className: "flex items-center gap-1",
                        children: [(0, s.jsx)(j(), {
                          href: "/customers/detail?id=".concat(e.id),
                          className: "btn-ghost btn-sm",
                          children: "View"
                        }), (null == b ? void 0 : b.role) === "ADMIN" && (0, s.jsx)("button", {
                          onClick: () => B(e),
                          className: "btn-ghost btn-sm",
                          children: "Edit"
                        })]
                      })
                    })]
                  }, e.id)) : (0, s.jsx)("tr", {
                    children: (0, s.jsxs)("td", {
                      colSpan: 7,
                      className: "px-4 py-12 text-center",
                      children: [(0, s.jsx)(u.Z, {
                        className: "w-10 h-10 text-slate-300 mx-auto mb-2"
                      }), (0, s.jsx)("p", {
                        className: "text-muted",
                        children: "No customers found"
                      }), (0, s.jsx)("button", {
                        onClick: J,
                        className: "btn-primary btn-sm mt-3",
                        children: "Add first customer"
                      })]
                    })
                  })
                })]
              })
            })
          }), (0, s.jsxs)(i.Z, {
            open: I,
            onClose: K,
            title: E ? "Edit customer" : "Add new customer",
            size: "lg",
            footer: (0, s.jsxs)(s.Fragment, {
              children: [(0, s.jsx)("button", {
                onClick: K,
                className: "btn-secondary",
                children: "Cancel"
              }), (0, s.jsxs)("button", {
                onClick: () => {
                  if (!_.companyName || !_.contactPerson || !_.contactNumber) {
                    F("Company name, contact person, and phone are required.");
                    return
                  }
                  z.mutate(_)
                },
                className: "btn-primary",
                disabled: z.isPending,
                children: [z.isPending && (0, s.jsx)(g.Z, {
                  className: "w-4 h-4 animate-spin"
                }), E ? "Save changes" : "Add customer"]
              })]
            }),
            children: [q && (0, s.jsx)("div", {
              className: "mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg text-sm",
              children: q
            }), (0, s.jsxs)("div", {
              className: "grid grid-cols-1 sm:grid-cols-2 gap-4",
              children: [
                [{
                  k: "companyName",
                  label: "Company name *",
                  type: "text"
                }, {
                  k: "contactPerson",
                  label: "Contact person *",
                  type: "text"
                }, {
                  k: "contactNumber",
                  label: "Phone *",
                  type: "tel"
                }, {
                  k: "designation",
                  label: "Designation",
                  type: "text"
                }, {
                  k: "email",
                  label: "Email",
                  type: "email"
                }, {
                  k: "location",
                  label: "City / Region",
                  type: "text"
                }].map(e => {
                  let {
                    k: t,
                    label: a,
                    type: n
                  } = e;
                  return (0, s.jsxs)("div", {
                    children: [(0, s.jsx)("label", {
                      className: "label",
                      children: a
                    }), (0, s.jsx)("input", {
                      type: n,
                      value: _[t],
                      onChange: H(t),
                      className: "input"
                    })]
                  }, t)
                }), (0, s.jsxs)("div", {
                  className: "sm:col-span-2",
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Full address"
                  }), (0, s.jsx)("textarea", {
                    value: _.address,
                    onChange: H("address"),
                    rows: 2,
                    className: "input",
                    placeholder: "Street, area, city, pincode…"
                  })]
                }), (0, s.jsxs)("div", {
                  className: "sm:col-span-2 flex flex-col sm:flex-row sm:items-center gap-2 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700",
                  children: [(0, s.jsxs)("button", {
                    type: "button",
                    onClick: Y,
                    disabled: R,
                    className: "btn-secondary btn-sm shrink-0",
                    children: [R ? (0, s.jsx)(g.Z, {
                      className: "w-3.5 h-3.5 animate-spin"
                    }) : (0, s.jsx)(v.Z, {
                      className: "w-3.5 h-3.5"
                    }), R ? "Locating…" : "Use my current location"]
                  }), O && (0, s.jsx)("span", {
                    className: "text-xs ".concat("ok" === O.type ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"),
                    children: O.msg
                  }), !O && !R && (0, s.jsx)("span", {
                    className: "text-xs text-slate-400",
                    children: "Captures your exact GPS position for this customer's check-in geo-fence."
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsxs)("label", {
                    className: "label flex items-center gap-1.5",
                    children: [(0, s.jsx)(h.Z, {
                      className: "w-3.5 h-3.5 text-primary"
                    }), " GPS latitude"]
                  }), (0, s.jsx)("input", {
                    type: "number",
                    step: "0.000001",
                    value: _.lat,
                    onChange: H("lat"),
                    className: "input",
                    placeholder: "e.g. 18.5204"
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "GPS longitude"
                  }), (0, s.jsx)("input", {
                    type: "number",
                    step: "0.000001",
                    value: _.lng,
                    onChange: H("lng"),
                    className: "input",
                    placeholder: "e.g. 73.8567"
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Geo-fence radius (metres)"
                  }), (0, s.jsx)("input", {
                    type: "number",
                    min: "50",
                    max: "5000",
                    value: _.geoFenceRadius,
                    onChange: H("geoFenceRadius"),
                    className: "input"
                  }), (0, s.jsx)("p", {
                    className: "text-xs text-slate-400 mt-1",
                    children: "Check-in is only allowed within this radius of the customer GPS pin."
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Google Maps link"
                  }), (0, s.jsx)("input", {
                    type: "url",
                    value: _.mapsLink,
                    onChange: H("mapsLink"),
                    className: "input",
                    placeholder: "https://maps.google.com/…"
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Status"
                  }), (0, s.jsx)("select", {
                    value: _.status,
                    onChange: H("status"),
                    className: "input",
                    children: w.map(e => (0, s.jsx)("option", {
                      value: e,
                      children: e
                    }, e))
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Customer category"
                  }), (0, s.jsxs)("select", {
                    value: _.category,
                    onChange: H("category"),
                    className: "input",
                    children: [(0, s.jsx)("option", {
                      value: "",
                      children: "Select…"
                    }), f.map(e => (0, s.jsx)("option", {
                      children: e
                    }, e))]
                  })]
                }), (0, s.jsxs)("div", {
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Industry type"
                  }), (0, s.jsxs)("select", {
                    value: _.industryType,
                    onChange: H("industryType"),
                    className: "input",
                    children: [(0, s.jsx)("option", {
                      value: "",
                      children: "Select…"
                    }), N.map(e => (0, s.jsx)("option", {
                      children: e
                    }, e))]
                  })]
                }), (0, s.jsxs)("div", {
                  className: "sm:col-span-2",
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Machine details"
                  }), (0, s.jsx)("textarea", {
                    value: _.machineDetails,
                    onChange: H("machineDetails"),
                    rows: 2,
                    className: "input",
                    placeholder: "Machine models, makes, years, specs…"
                  })]
                }), (0, s.jsxs)("div", {
                  className: "sm:col-span-2",
                  children: [(0, s.jsx)("label", {
                    className: "label",
                    children: "Remarks"
                  }), (0, s.jsx)("textarea", {
                    value: _.remarks,
                    onChange: H("remarks"),
                    rows: 2,
                    className: "input"
                  })]
                })
              ]
            })]
          })]
        })
      }
    },
    40094: function(e, t, a) {
      "use strict";
      a.d(t, {
        Z: function() {
          return o
        }
      });
      var s = a(57437),
        n = a(2265),
        l = a(82549),
        c = a(57042);
      let r = {
        sm: "max-w-sm",
        md: "max-w-md",
        lg: "max-w-2xl",
        xl: "max-w-4xl"
      };

      function o(e) {
        let {
          open: t,
          onClose: a,
          title: o,
          children: i,
          size: d = "md",
          footer: m
        } = e;
        return ((0, n.useEffect)(() => (t ? document.body.style.overflow = "hidden" : document.body.style.overflow = "", () => {
          document.body.style.overflow = ""
        }), [t]), t) ? (0, s.jsxs)("div", {
          className: "fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4",
          children: [(0, s.jsx)("div", {
            className: "absolute inset-0 bg-black/50 backdrop-blur-sm",
            onClick: a
          }), (0, s.jsxs)("div", {
            className: (0, c.Z)("relative z-10 w-full bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-xl shadow-2xl flex flex-col", r[d], "max-h-[90vh]"),
            children: [(0, s.jsxs)("div", {
              className: "flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0",
              children: [(0, s.jsx)("h2", {
                className: "text-base font-semibold text-slate-900 dark:text-slate-100",
                children: o
              }), (0, s.jsx)("button", {
                onClick: a,
                className: "p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800",
                children: (0, s.jsx)(l.Z, {
                  className: "w-4 h-4"
                })
              })]
            }), (0, s.jsx)("div", {
              className: "flex-1 overflow-y-auto p-5",
              children: i
            }), m && (0, s.jsx)("div", {
              className: "px-5 py-4 border-t border-slate-200 dark:border-slate-700 shrink-0 flex justify-end gap-2",
              children: m
            })]
          })]
        }) : null
      }
    },
    58222: function(e, t, a) {
      "use strict";
      a.d(t, {
        RJ: function() {
          return x
        },
        Yc: function() {
          return g
        },
        Yu: function() {
          return v
        },
        fi: function() {
          return d
        },
        g8: function() {
          return r
        },
        hi: function() {
          return l
        },
        iJ: function() {
          return c
        },
        ir: function() {
          return h
        },
        jU: function() {
          return u
        },
        kx: function() {
          return p
        },
        v7: function() {
          return o
        },
        vm: function() {
          return m
        },
        xr: function() {
          return i
        }
      });
      var s = a(66379);
      let n = "https://api.apjtech.in",
        l = s.Z.create({
          baseURL: "".concat(n, "/api"),
          timeout: 15e3,
          headers: {
            "Content-Type": "application/json"
          }
        });
      l.interceptors.request.use(e => {
        {
          let t = localStorage.getItem("crm_token");
          t && (e.headers.Authorization = "Bearer ".concat(t))
        }
        return e
      }), l.interceptors.response.use(e => e, e => {
        var t;
        return (null === (t = e.response) || void 0 === t ? void 0 : t.status) === 401 && (localStorage.removeItem("crm_token"), localStorage.removeItem("crm_user"), window.location.href = "/login"), Promise.reject(e)
      });
      let c = {
          login: (e, t) => l.post("/auth/login", {
            email: e,
            password: t
          }),
          me: () => l.get("/auth/me"),
          changePassword: (e, t) => l.put("/auth/change-password", {
            currentPassword: e,
            newPassword: t
          }),
          updateProfile: e => l.put("/auth/profile", e),
          logout: () => l.post("/auth/logout")
        },
        r = {
          list: e => l.get("/users", {
            params: e
          }),
          get: e => l.get("/users/".concat(e)),
          create: e => l.post("/users", e),
          update: (e, t) => l.put("/users/".concat(e), t),
          resetPassword: (e, t) => l.patch("/users/".concat(e, "/reset-password"), {
            newPassword: t
          }),
          toggleLock: e => l.patch("/users/".concat(e, "/toggle-lock")),
          reactivate: e => l.patch("/users/".concat(e, "/reactivate")),
          deactivate: e => l.delete("/users/".concat(e))
        },
        o = {
          list: e => l.get("/customers", {
            params: e
          }),
          get: e => l.get("/customers/".concat(e)),
          withLocation: () => l.get("/customers/with-location"),
          create: e => l.post("/customers", e),
          update: (e, t) => l.put("/customers/".concat(e), t),
          delete: e => l.delete("/customers/".concat(e)),
          filterMeta: () => l.get("/customers/meta/filters")
        },
        i = {
          list: e => l.get("/meetings", {
            params: e
          }),
          get: e => l.get("/meetings/".concat(e)),
          create: e => l.post("/meetings", e),
          update: (e, t) => l.put("/meetings/".concat(e), t),
          todayFollowups: () => l.get("/meetings/today-followups"),
          alerts: () => l.get("/meetings/alerts"),
          markAlertRead: e => l.patch("/meetings/alerts/".concat(e, "/read")),
          checkIn: (e, t, a) => l.post("/meetings/".concat(e, "/checkin"), {
            lat: t,
            lng: a
          }),
          timer: (e, t) => l.patch("/meetings/".concat(e, "/timer"), {
            action: t
          }),
          customerVisits: e => l.get("/meetings/customer/".concat(e, "/visits"))
        },
        d = {
          list: e => l.get("/products", {
            params: e
          }),
          get: e => l.get("/products/".concat(e)),
          searchByCode: e => l.get("/products/code/".concat(encodeURIComponent(e))),
          autocomplete: e => l.get("/products/search", {
            params: {
              q: e
            }
          }),
          create: e => l.post("/products", e),
          update: (e, t) => l.put("/products/".concat(e), t)
        },
        m = {
          checkIn: (e, t) => l.post("/attendance/checkin", {
            lat: e,
            lng: t
          }),
          checkOut: (e, t) => l.post("/attendance/checkout", {
            lat: e,
            lng: t
          }),
          today: () => l.get("/attendance/today"),
          list: e => l.get("/attendance", {
            params: e
          }),
          ping: (e, t, a) => l.post("/attendance/ping", {
            lat: e,
            lng: t,
            accuracy: a
          }),
          live: () => l.get("/attendance/live"),
          locations: e => l.get("/attendance/".concat(e, "/locations"))
        },
        u = {
          list: e => l.get("/leaves", {
            params: e
          }),
          create: e => l.post("/leaves", e),
          approve: (e, t, a) => l.patch("/leaves/".concat(e, "/approve"), {
            status: t,
            adminNote: a
          })
        },
        p = {
          admin: () => l.get("/dashboard/admin"),
          user: () => l.get("/dashboard/user")
        },
        h = {
          list: e => l.get("/activity", {
            params: e
          })
        },
        x = {
          list: e => l.get("/quotations", {
            params: e
          }),
          stats: () => l.get("/quotations/stats"),
          get: e => l.get("/quotations/".concat(e)),
          create: e => l.post("/quotations", e),
          update: (e, t) => l.put("/quotations/".concat(e), t),
          delete: e => l.delete("/quotations/".concat(e)),
          approve: (e, t, a) => l.patch("/quotations/".concat(e, "/approve"), {
            action: t,
            note: a
          }),
          pdfUrl: e => "".concat(n, "/api/quotations/").concat(e, "/pdf")
        },
        g = {
          list: () => l.get("/categories"),
          create: e => l.post("/categories", e),
          update: (e, t) => l.put("/categories/".concat(e), t),
          delete: e => l.delete("/categories/".concat(e))
        },
        v = {
          overview: () => l.get("/analytics/overview"),
          monthly: e => l.get("/analytics/monthly", {
            params: {
              months: e
            }
          }),
          employee: () => l.get("/analytics/employee"),
          segmentation: () => l.get("/analytics/segmentation"),
          winLoss: () => l.get("/analytics/win-loss")
        }
    },
    8032: function(e, t, a) {
      "use strict";
      a.d(t, {
        t: function() {
          return s
        }
      });
      let s = (0, a(94660).Ue)(e => ({
        user: null,
        token: null,
        isAuthenticated: !1,
        setAuth: (t, a) => {
          localStorage.setItem("crm_token", a), localStorage.setItem("crm_user", JSON.stringify(t)), e({
            user: t,
            token: a,
            isAuthenticated: !0
          })
        },
        clearAuth: () => {
          localStorage.removeItem("crm_token"), localStorage.removeItem("crm_user"), e({
            user: null,
            token: null,
            isAuthenticated: !1
          })
        },
        loadFromStorage: () => {
          let t = localStorage.getItem("crm_token"),
            a = localStorage.getItem("crm_user");
          if (t && a) try {
            let s = JSON.parse(a);
            e({
              user: s,
              token: t,
              isAuthenticated: !0
            })
          } catch (e) {
            localStorage.removeItem("crm_token"), localStorage.removeItem("crm_user")
          }
        }
      }))
    }
  },
  function(e) {
    e.O(0, [8709, 7882, 9891, 5582, 1487, 2971, 4938, 1744], function() {
      return e(e.s = 1039)
    }), _N_E = e.O()
  }
]);